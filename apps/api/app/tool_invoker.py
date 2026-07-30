"""Turning a ``ToolStep`` into a real call against a connected system.

This is the piece that was missing. The executor used to answer every tool step
with ``{"prepared": True, "records_changed": 0}`` — no credential was read and no
packet left the process. :class:`McpToolInvoker` resolves the step's
``connection_id`` to the tenant's stored connection, decrypts its token, and
invokes ``tool_name`` over MCP.

Two things worth knowing:

* **Policy.** Reads execute for real. Writes raise :class:`ToolPolicyError`
  unless ``WORKPILOT_ALLOW_TOOL_WRITES`` is on, and the invoker cross-checks the
  step's declared ``mode`` against the server's own read-only hint so a step
  cannot smuggle a mutation through by claiming to be a read.
* **Sessions are reused.** One MCP handshake per connection per run, not per
  step, so a three-step Scoro workflow performs one ``initialize``.
"""

from __future__ import annotations

import logging
import re
import time
from typing import Any, Protocol

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.connectors import RestToolError, get_rest_connector
from app.crypto import CredentialEncryptionError, decrypt_secret
from app.mcp import McpAuthError, McpClient, McpError
from app.models import Connection
from app.schemas import ToolStep

logger = logging.getLogger(__name__)

# Matches a whole-value reference ("{{a.b}}") or one embedded in a string.
_TEMPLATE_RE = re.compile(r"\{\{\s*([a-zA-Z0-9_.\-\[\]]+)\s*\}\}")


class ToolInvocationError(RuntimeError):
    """A tool call was attempted and failed."""


class ToolPolicyError(ToolInvocationError):
    """A tool call was refused by WorkPilot's execution policy."""


class ToolInvoker(Protocol):
    """What the executor needs from whatever performs tool calls."""

    async def invoke(
        self, step: ToolStep, context: dict[str, Any]
    ) -> tuple[dict[str, Any], dict[str, Any]]:
        """Run ``step`` and return ``(output_data, tool_usage)``."""
        ...


# -- argument templating --------------------------------------------------


def _lookup(path: str, context: dict[str, Any]) -> Any:
    """Resolve a dotted path against the run context.

    Looks in the per-step namespace first (``_steps.<step_id>.<field>``) so
    ``{{fetchProjects.projects}}`` works, then falls back to the flat merged
    context for legacy references. List indices are supported: ``items.0.id``.
    """
    parts = [p for p in path.replace("[", ".").replace("]", "").split(".") if p]
    if not parts:
        return None

    steps = context.get("_steps")
    roots: list[Any] = []
    if isinstance(steps, dict) and parts[0] in steps:
        roots.append({parts[0]: steps[parts[0]]})
    roots.append(context)

    for root in roots:
        current: Any = root
        for part in parts:
            if isinstance(current, dict):
                if part not in current:
                    current = None
                    break
                current = current[part]
            elif isinstance(current, (list, tuple)):
                if not part.isdigit() or int(part) >= len(current):
                    current = None
                    break
                current = current[int(part)]
            else:
                current = None
                break
        if current is not None:
            return current
    return None


def resolve_template(value: Any, context: dict[str, Any]) -> Any:
    """Substitute ``{{ref}}`` templates in ``value`` using ``context``.

    A string that is exactly one reference yields the referenced value with its
    type intact (a list stays a list). A reference embedded in surrounding text
    is stringified and interpolated.
    """
    if isinstance(value, str):
        whole = _TEMPLATE_RE.fullmatch(value.strip())
        if whole:
            return _lookup(whole.group(1), context)

        def _sub(match: re.Match[str]) -> str:
            found = _lookup(match.group(1), context)
            return "" if found is None else str(found)

        return _TEMPLATE_RE.sub(_sub, value)

    if isinstance(value, dict):
        return {k: resolve_template(v, context) for k, v in value.items()}
    if isinstance(value, list):
        return [resolve_template(v, context) for v in value]
    return value


def _summarize(result: Any) -> dict[str, Any]:
    """Describe a tool result so the UI can show something meaningful."""
    if isinstance(result, list):
        return {"kind": "list", "count": len(result)}
    if isinstance(result, dict):
        for key in ("items", "data", "records", "results", "projects", "files"):
            inner = result.get(key)
            if isinstance(inner, list):
                return {"kind": "list", "count": len(inner), "container": key}
        return {"kind": "object", "keys": sorted(result)[:20]}
    if isinstance(result, str):
        return {"kind": "text", "length": len(result)}
    return {"kind": type(result).__name__}


# -- the real invoker -----------------------------------------------------


class McpToolInvoker:
    """Invokes tool steps against the tenant's MCP connections.

    Use as an async context manager so pooled MCP sessions are closed::

        async with McpToolInvoker(session, tenant_id) as invoker:
            results = await NativeExecutor(tool_invoker=invoker).execute(...)
    """

    def __init__(self, session: AsyncSession, tenant_id: str) -> None:
        self._session = session
        self._tenant_id = tenant_id
        self._connections: dict[str, Connection] = {}
        self._clients: dict[str, McpClient] = {}

    async def __aenter__(self) -> McpToolInvoker:
        return self

    async def __aexit__(self, *exc: Any) -> None:
        await self.aclose()

    async def aclose(self) -> None:
        for client in self._clients.values():
            try:
                await client.aclose()
            except Exception:  # pragma: no cover - best-effort cleanup
                logger.debug("failed closing an MCP session", exc_info=True)
        self._clients.clear()

    async def _get_connection(self, connection_id: str) -> Connection:
        if connection_id in self._connections:
            return self._connections[connection_id]

        connection = await self._session.scalar(
            select(Connection).where(
                Connection.id == connection_id,
                Connection.tenant_id == self._tenant_id,
            )
        )
        if connection is None:
            raise ToolInvocationError(
                f"connection {connection_id!r} does not exist for this workspace — "
                "reconnect it on the Connections page"
            )
        self._connections[connection_id] = connection
        return connection

    async def _get_client(self, connection: Connection) -> McpClient:
        if connection.id in self._clients:
            return self._clients[connection.id]

        if not connection.base_url:
            raise ToolInvocationError(f"connection {connection.name!r} has no server URL configured")

        try:
            token = decrypt_secret(connection.encrypted_token)
        except CredentialEncryptionError as exc:
            raise ToolInvocationError(f"connection {connection.name!r}: {exc}") from exc

        client = McpClient(
            connection.base_url,
            token=token,
            timeout=get_settings().tool_timeout_seconds,
        )
        try:
            await client.connect()
        except McpAuthError as exc:
            await client.aclose()
            raise ToolInvocationError(
                f"connection {connection.name!r} was rejected: {exc}. "
                "Update its API token on the Connections page."
            ) from exc
        except McpError as exc:
            await client.aclose()
            raise ToolInvocationError(f"connection {connection.name!r} is unreachable: {exc}") from exc

        self._clients[connection.id] = client
        return client

    def _catalog_entry(self, connection: Connection, tool_name: str) -> dict[str, Any] | None:
        for entry in connection.tool_catalog or []:
            if isinstance(entry, dict) and entry.get("name") == tool_name:
                return entry
        return None

    def _required_args(self, connection: Connection, tool_name: str) -> set[str]:
        """Names the tool's own schema marks as required."""
        entry = self._catalog_entry(connection, tool_name) or {}
        schema = entry.get("input_schema") or {}
        required = schema.get("required") if isinstance(schema, dict) else None
        return set(required) if isinstance(required, list) else set()

    async def _dispatch(
        self, connection: Connection, tool_name: str, arguments: dict[str, Any]
    ) -> Any:
        """Route to the right transport: an MCP session or a REST connector."""
        rest_cls = get_rest_connector(connection.connector_id)
        if connection.kind != "mcp" and rest_cls is not None:
            try:
                token = decrypt_secret(connection.encrypted_token)
            except CredentialEncryptionError as exc:
                raise ToolInvocationError(f"connection {connection.name!r}: {exc}") from exc
            connector = rest_cls(
                connection.base_url, token, timeout=get_settings().tool_timeout_seconds
            )
            return await connector.call(tool_name, arguments)

        client = await self._get_client(connection)
        return await client.call_tool(tool_name, arguments)

    def _enforce_policy(self, step: ToolStep, connection: Connection) -> None:
        """Refuse writes unless explicitly allowed.

        Checks the step's declared ``mode`` *and* the cached catalog's read-only
        flag, so mislabelling a mutating tool as a read does not bypass the gate.
        """
        settings = get_settings()
        if settings.allow_tool_writes:
            return

        declared_write = step.mode == "write"
        entry = self._catalog_entry(connection, step.tool_name or "")
        catalog_write = entry is not None and entry.get("read_only") is False

        if declared_write or catalog_write:
            reason = (
                "the step is marked as a write"
                if declared_write
                else f"{connection.name} reports {step.tool_name!r} as a mutating tool"
            )
            raise ToolPolicyError(
                f"refusing to run {step.tool_name!r}: {reason}. WorkPilot is in "
                "read-only mode — set WORKPILOT_ALLOW_TOOL_WRITES=true (behind an "
                "approval gate) to permit writes."
            )

    async def invoke(
        self, step: ToolStep, context: dict[str, Any]
    ) -> tuple[dict[str, Any], dict[str, Any]]:
        if not step.is_bound:
            # Unbound step: nothing to call. Say so plainly rather than
            # reporting a fake success, which is what used to happen.
            return (
                {
                    "status": "not_configured",
                    "message": (
                        f"Step {step.id!r} is not connected to a tool yet. Pick a "
                        "connection and a tool for it on the Build tab."
                    ),
                    "operation": step.operation,
                },
                {"invoked": False, "reason": "no_connection_bound"},
            )

        connection = await self._get_connection(step.connection_id or "")
        self._enforce_policy(step, connection)

        resolved = resolve_template(step.arguments, context)
        if not isinstance(resolved, dict):
            raise ToolInvocationError(
                f"step {step.id!r} arguments must resolve to an object, got {type(resolved).__name__}"
            )

        # Drop arguments whose template resolved to nothing. Passing them through
        # as null made the tool reject the call with a type error
        # ("Input should be a valid string, input_value=None") which read as a
        # broken workflow rather than a missing input.
        arguments = {key: val for key, val in resolved.items() if val is not None}
        dropped = sorted(set(resolved) - set(arguments))
        if dropped:
            required = self._required_args(connection, step.tool_name or "")
            missing = [key for key in dropped if key in required]
            if missing:
                sources = ", ".join(
                    f"{key}={step.arguments.get(key)!r}" for key in missing
                )
                raise ToolInvocationError(
                    f"{connection.name} · {step.tool_name}: required argument(s) "
                    f"{', '.join(missing)} resolved to nothing ({sources}). Supply it "
                    "in the run input, or point the template at a step that produces it."
                )
            logger.info("step %s: dropped empty optional arguments %s", step.id, dropped)

        started = time.monotonic()
        try:
            result = await self._dispatch(connection, step.tool_name or "", arguments)
        except (McpError, RestToolError) as exc:
            raise ToolInvocationError(
                f"{connection.name} · {step.tool_name}: {exc}"
            ) from exc
        duration_ms = int((time.monotonic() - started) * 1000)

        tool_usage = {
            "invoked": True,
            "connection_id": connection.id,
            "connection_name": connection.name,
            "connector_id": connection.connector_id,
            "tool_name": step.tool_name,
            "mode": step.mode,
            "arguments": arguments,
            "duration_ms": duration_ms,
            "result": _summarize(result),
        }
        output = {"status": "ok", "tool": step.tool_name, "result": result}
        return output, tool_usage

    # -- LiveToolProvider: lets an ai_task call tools on its own --------------

    async def load_catalog(self) -> None:
        """Pre-load the tenant's connected servers so ``describe_tools`` works."""
        rows = await self._session.scalars(
            select(Connection).where(
                Connection.tenant_id == self._tenant_id,
                Connection.status == "connected",
            )
        )
        for connection in rows:
            self._connections[connection.id] = connection

    def describe_tools(self) -> list[dict[str, Any]]:
        """Read-only tools the agent may call. Writes are never offered."""
        allow_writes = get_settings().allow_tool_writes
        specs: list[dict[str, Any]] = []
        for connection in self._connections.values():
            for entry in connection.tool_catalog or []:
                if not isinstance(entry, dict) or not entry.get("name"):
                    continue
                if not allow_writes and entry.get("read_only") is False:
                    continue
                specs.append(
                    {
                        "connection_id": connection.id,
                        "connection_name": connection.name,
                        "connector_id": connection.connector_id,
                        "tool_name": entry["name"],
                        "description": entry.get("description", ""),
                        "input_schema": entry.get("input_schema") or {},
                    }
                )
        return specs

    async def call_named_tool(
        self, connection_id: str, tool_name: str, arguments: dict[str, Any]
    ) -> Any:
        """Invoke a tool the agent chose. Re-checks policy — the model is untrusted."""
        connection = await self._get_connection(connection_id)
        probe = ToolStep(
            id="agent_tool_call",
            name="Agent tool call",
            type="tool",
            connection_id=connection_id,
            tool_name=tool_name,
            mode="read",
        )
        self._enforce_policy(probe, connection)
        clean = {k: v for k, v in (arguments or {}).items() if v is not None}
        return await self._dispatch(connection, tool_name, clean)


class UnboundToolInvoker:
    """Fallback used when no database session is available (unit tests, CI).

    Reports honestly that nothing was called instead of fabricating a result.
    """

    async def invoke(
        self, step: ToolStep, context: dict[str, Any]
    ) -> tuple[dict[str, Any], dict[str, Any]]:
        return (
            {
                "status": "skipped",
                "message": "No tool invoker is configured in this environment.",
                "operation": step.operation,
            },
            {"invoked": False, "reason": "no_invoker"},
        )
