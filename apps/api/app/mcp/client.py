"""An async MCP client over the streamable-HTTP transport.

Implements the subset of the Model Context Protocol that WorkPilot needs:

    initialize  ->  notifications/initialized  ->  tools/list  ->  tools/call

The transport is a single HTTP endpoint that accepts JSON-RPC POSTs and may
reply with either ``application/json`` or an ``text/event-stream`` SSE frame,
so every response goes through :func:`_parse_payload`. Servers that implement
sessions return an ``mcp-session-id`` response header on ``initialize`` which
must be echoed on every subsequent request.

Read-vs-write matters here: WorkPilot's execution policy permits reads to run
for real but refuses writes, so :func:`is_read_only_tool` classifies a tool by
its declared annotations (falling back to a name heuristic) and the executor
enforces the decision.
"""

from __future__ import annotations

import json
import logging
from dataclasses import dataclass, field
from typing import Any

import httpx

logger = logging.getLogger(__name__)

PROTOCOL_VERSION = "2024-11-05"
CLIENT_INFO = {"name": "workpilot", "version": "1.0"}
DEFAULT_TIMEOUT = 30.0

# Tool-name prefixes that indicate a side-effect-free read. Used only when the
# server does not declare `annotations.readOnlyHint`.
_READ_PREFIXES = (
    "get", "list", "search", "read", "fetch", "find", "query", "describe",
    "show", "lookup", "retrieve", "count", "export", "download", "view",
    # Pure transformations of their input — no state anywhere is changed.
    "summar", "analyz", "analys", "classif", "extract", "calculate", "convert",
    "validate", "check", "compare", "translate", "render", "preview",
)
_WRITE_PREFIXES = (
    "create", "update", "delete", "remove", "insert", "add", "set", "put",
    "patch", "post", "send", "write", "modify", "archive", "move", "upload",
    "invite", "assign", "close", "cancel", "approve", "reject", "merge",
)


class McpError(RuntimeError):
    """An MCP server returned an error, or the transport failed."""


class McpAuthError(McpError):
    """The server rejected our credentials (HTTP 401/403)."""


@dataclass
class McpTool:
    """One tool advertised by an MCP server."""

    name: str
    description: str = ""
    input_schema: dict[str, Any] = field(default_factory=dict)
    read_only: bool = True

    def to_dict(self) -> dict[str, Any]:
        return {
            "name": self.name,
            "description": self.description,
            "input_schema": self.input_schema,
            "read_only": self.read_only,
        }

    @classmethod
    def from_dict(cls, raw: dict[str, Any]) -> McpTool:
        return cls(
            name=str(raw.get("name", "")),
            description=str(raw.get("description") or ""),
            input_schema=raw.get("input_schema") or raw.get("inputSchema") or {},
            read_only=bool(raw.get("read_only", True)),
        )


def is_read_only_tool(raw: dict[str, Any]) -> bool:
    """Classify a ``tools/list`` entry as read-only.

    Prefers the server's own ``annotations.readOnlyHint``. When absent, falls
    back to the verb at the start of the tool name. Unknown verbs are treated
    as **writes** — the conservative choice, since a false "read" could mutate
    a customer's live data.
    """
    annotations = raw.get("annotations") or {}
    if isinstance(annotations, dict):
        hint = annotations.get("readOnlyHint")
        if isinstance(hint, bool):
            return hint
        if annotations.get("destructiveHint") is True:
            return False

    name = str(raw.get("name", "")).lower().replace("-", "_")
    leading = name.split("_")[0]
    if leading in _READ_PREFIXES or name.startswith(_READ_PREFIXES):
        return True
    if leading in _WRITE_PREFIXES or name.startswith(_WRITE_PREFIXES):
        return False
    return False


def _parse_payload(response: httpx.Response) -> dict[str, Any]:
    """Decode a JSON-RPC reply that may arrive as JSON or as an SSE frame."""
    text = response.text or ""
    content_type = response.headers.get("content-type", "")

    if "text/event-stream" in content_type or text.lstrip().startswith(("event:", "data:")):
        for line in text.splitlines():
            if line.startswith("data:"):
                chunk = line[5:].strip()
                if not chunk or chunk == "[DONE]":
                    continue
                try:
                    parsed = json.loads(chunk)
                except json.JSONDecodeError:
                    continue
                if isinstance(parsed, dict):
                    return parsed
        raise McpError("server sent an event stream with no decodable JSON-RPC payload")

    if not text.strip():
        return {}

    try:
        parsed = json.loads(text)
    except json.JSONDecodeError as exc:
        snippet = text[:200].replace("\n", " ")
        raise McpError(f"server did not return JSON (got: {snippet!r})") from exc

    if not isinstance(parsed, dict):
        raise McpError(f"expected a JSON-RPC object, got {type(parsed).__name__}")
    return parsed


def _coerce_json(value: Any) -> Any:
    """Parse a string that is actually JSON; pass anything else through.

    MCP tools return their payload as text, so a tool that conceptually returns
    records hands back a JSON *string*. Decoding it here is what lets a later
    step address ``{{fetchTasks.result.tasks}}`` instead of a blob.
    """
    if isinstance(value, str):
        stripped = value.strip()
        if stripped[:1] in ("{", "["):
            try:
                return json.loads(stripped)
            except json.JSONDecodeError:
                return value
    return value


def _unwrap_structured(structured: Any) -> Any:
    """Strip the single-key envelope some servers wrap scalar results in.

    FastMCP (and other SDKs following the same convention) reports a tool whose
    return type is not an object as ``structuredContent = {"result": <value>}``.
    Passing that through verbatim gave downstream steps a pointless extra level
    plus, for JSON-returning tools, an undecoded string.
    """
    if isinstance(structured, dict) and set(structured) == {"result"}:
        return _coerce_json(structured["result"])
    if isinstance(structured, dict):
        return {key: _coerce_json(val) for key, val in structured.items()}
    return _coerce_json(structured)


def _flatten_content(content: Any) -> Any:
    """Turn an MCP ``content`` block list into plain Python data.

    Text blocks holding JSON are decoded so downstream steps get structured
    records rather than a string that merely looks like JSON.
    """
    if not isinstance(content, list):
        return content

    parts: list[Any] = []
    for block in content:
        if not isinstance(block, dict):
            parts.append(block)
            continue
        kind = block.get("type")
        if kind == "text":
            raw = block.get("text", "")
            stripped = raw.strip() if isinstance(raw, str) else raw
            if isinstance(stripped, str) and stripped[:1] in ("{", "["):
                try:
                    parts.append(json.loads(stripped))
                    continue
                except json.JSONDecodeError:
                    pass
            parts.append(raw)
        elif kind in ("resource", "embedded_resource"):
            parts.append(block.get("resource") or block)
        else:
            parts.append(block)

    if len(parts) == 1:
        return parts[0]
    return parts


class McpClient:
    """A session against one MCP server.

    Use as an async context manager so the HTTP connection and the negotiated
    session are always released::

        async with McpClient(url, token) as mcp:
            tools = await mcp.list_tools()
            data = await mcp.call_tool("list_projects", {})
    """

    def __init__(
        self,
        endpoint: str,
        token: str | None = None,
        timeout: float = DEFAULT_TIMEOUT,
        extra_headers: dict[str, str] | None = None,
    ) -> None:
        self._endpoint = endpoint.rstrip("/")
        self._token = token
        self._timeout = timeout
        self._extra_headers = extra_headers or {}
        self._session_id: str | None = None
        self._request_id = 0
        self._client: httpx.AsyncClient | None = None
        self._server_info: dict[str, Any] = {}

    # -- lifecycle ---------------------------------------------------------

    async def __aenter__(self) -> McpClient:
        self._client = httpx.AsyncClient(timeout=self._timeout, follow_redirects=True)
        await self.connect()
        return self

    async def __aexit__(self, *exc: Any) -> None:
        await self.aclose()

    async def aclose(self) -> None:
        if self._client is not None:
            await self._client.aclose()
            self._client = None

    @property
    def server_info(self) -> dict[str, Any]:
        return self._server_info

    # -- transport ---------------------------------------------------------

    def _headers(self) -> dict[str, str]:
        headers = {
            "Content-Type": "application/json",
            "Accept": "application/json, text/event-stream",
            **self._extra_headers,
        }
        if self._token:
            headers["Authorization"] = f"Bearer {self._token}"
        if self._session_id:
            headers["mcp-session-id"] = self._session_id
        return headers

    def _next_id(self) -> int:
        self._request_id += 1
        return self._request_id

    async def _post(self, body: dict[str, Any]) -> httpx.Response:
        if self._client is None:
            raise McpError("client is not open — use `async with McpClient(...)`")
        try:
            response = await self._client.post(self._endpoint, headers=self._headers(), json=body)
        except httpx.TimeoutException as exc:
            raise McpError(f"timed out after {self._timeout:.0f}s contacting {self._endpoint}") from exc
        except httpx.HTTPError as exc:
            raise McpError(f"could not reach {self._endpoint}: {exc}") from exc

        if response.status_code in (401, 403):
            raise McpAuthError(
                "server rejected the credentials "
                f"(HTTP {response.status_code}) — check the API token for this connection"
            )
        if response.status_code >= 400:
            snippet = (response.text or "")[:200].replace("\n", " ")
            raise McpError(f"server returned HTTP {response.status_code}: {snippet}")
        return response

    async def _request(self, method: str, params: dict[str, Any] | None = None) -> Any:
        """Issue a JSON-RPC request and return its ``result``."""
        response = await self._post(
            {"jsonrpc": "2.0", "id": self._next_id(), "method": method, "params": params or {}}
        )
        payload = _parse_payload(response)

        if "error" in payload:
            error = payload["error"] or {}
            message = error.get("message", "unknown error") if isinstance(error, dict) else str(error)
            code = error.get("code") if isinstance(error, dict) else None
            raise McpError(f"{method} failed: {message}" + (f" (code {code})" if code else ""))
        return payload.get("result")

    async def _notify(self, method: str) -> None:
        """Fire a JSON-RPC notification (no id, no reply expected)."""
        try:
            await self._post({"jsonrpc": "2.0", "method": method})
        except McpError as exc:
            # A server that rejects the initialized notification is unusual but
            # not fatal — tools/list is what actually matters.
            logger.debug("MCP notification %s failed (continuing): %s", method, exc)

    # -- protocol ----------------------------------------------------------

    async def connect(self) -> dict[str, Any]:
        """Perform the ``initialize`` handshake and capture the session id."""
        if self._client is None:
            self._client = httpx.AsyncClient(timeout=self._timeout, follow_redirects=True)

        response = await self._post(
            {
                "jsonrpc": "2.0",
                "id": self._next_id(),
                "method": "initialize",
                "params": {
                    "protocolVersion": PROTOCOL_VERSION,
                    "capabilities": {},
                    "clientInfo": CLIENT_INFO,
                },
            }
        )

        # Sessions are optional in the spec; only some servers issue an id.
        self._session_id = response.headers.get("mcp-session-id")

        payload = _parse_payload(response)
        if "error" in payload:
            error = payload["error"] or {}
            message = error.get("message", "initialize rejected") if isinstance(error, dict) else str(error)
            raise McpError(f"initialize failed: {message}")

        result = payload.get("result") or {}
        self._server_info = result.get("serverInfo") or {}
        await self._notify("notifications/initialized")
        return result

    async def list_tools(self) -> list[McpTool]:
        """Enumerate the server's tools, following pagination cursors."""
        tools: list[McpTool] = []
        cursor: str | None = None

        for _ in range(20):  # bound the loop; 20 pages is far beyond any real server
            params = {"cursor": cursor} if cursor else {}
            result = await self._request("tools/list", params) or {}
            for raw in result.get("tools") or []:
                if not isinstance(raw, dict) or not raw.get("name"):
                    continue
                tools.append(
                    McpTool(
                        name=str(raw["name"]),
                        description=str(raw.get("description") or ""),
                        input_schema=raw.get("inputSchema") or {},
                        read_only=is_read_only_tool(raw),
                    )
                )
            cursor = result.get("nextCursor")
            if not cursor:
                break

        return tools

    async def call_tool(self, name: str, arguments: dict[str, Any] | None = None) -> Any:
        """Invoke a tool and return its flattened result.

        Raises :class:`McpError` when the server sets ``isError``, so a failed
        tool call cannot be mistaken for a successful empty one.
        """
        result = await self._request("tools/call", {"name": name, "arguments": arguments or {}})
        if not isinstance(result, dict):
            return result

        content = _flatten_content(result.get("content"))
        if result.get("isError"):
            raise McpError(f"tool {name!r} reported an error: {content}")

        structured = result.get("structuredContent")
        if structured not in (None, {}):
            return _unwrap_structured(structured)
        return content


# -- convenience wrappers -------------------------------------------------


async def discover_tools(
    endpoint: str, token: str | None = None, timeout: float = DEFAULT_TIMEOUT
) -> tuple[list[McpTool], dict[str, Any]]:
    """Connect, enumerate tools, disconnect. Returns (tools, server_info)."""
    async with McpClient(endpoint, token=token, timeout=timeout) as client:
        return await client.list_tools(), client.server_info


async def call_tool(
    endpoint: str,
    name: str,
    arguments: dict[str, Any] | None = None,
    token: str | None = None,
    timeout: float = DEFAULT_TIMEOUT,
) -> Any:
    """One-shot tool call for callers that do not hold a session open."""
    async with McpClient(endpoint, token=token, timeout=timeout) as client:
        return await client.call_tool(name, arguments)
