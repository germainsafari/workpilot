"""Shared shape for REST connectors.

A REST connector plays the same role an MCP server does: it advertises a set of
tools and executes them. The difference is that MCP servers describe themselves
over the wire, whereas a REST connector's catalog is declared in code because
each vendor's API is bespoke.

Everything here is read-only by construction — see :attr:`RestTool.read_only`,
which the executor's policy checks the same way it checks an MCP tool's
``readOnlyHint``.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any


class RestToolError(RuntimeError):
    """A REST tool call failed, or the vendor reported an error."""


class RestAuthError(RestToolError):
    """The vendor rejected the credential."""


@dataclass(frozen=True)
class RestTool:
    """One callable operation on a REST connector."""

    name: str
    description: str
    input_schema: dict[str, Any] = field(default_factory=dict)
    read_only: bool = True

    def to_dict(self) -> dict[str, Any]:
        return {
            "name": self.name,
            "description": self.description,
            "input_schema": self.input_schema,
            "read_only": self.read_only,
        }


class RestConnector:
    """Base class. Subclasses declare ``tools`` and implement ``call``."""

    #: Stable id, matching ``Connection.connector_id``.
    connector_id: str = "rest"
    #: Human label used in error messages.
    label: str = "REST service"

    def __init__(self, base_url: str, token: str | None, timeout: float = 30.0) -> None:
        self.base_url = (base_url or "").rstrip("/")
        self.token = token
        self.timeout = timeout

    # -- catalog -----------------------------------------------------------

    @classmethod
    def tools(cls) -> list[RestTool]:
        raise NotImplementedError

    @classmethod
    def tool_catalog(cls) -> list[dict[str, Any]]:
        return [tool.to_dict() for tool in cls.tools()]

    @classmethod
    def find_tool(cls, name: str) -> RestTool | None:
        return next((t for t in cls.tools() if t.name == name), None)

    # -- execution ---------------------------------------------------------

    async def verify(self) -> dict[str, Any]:
        """Cheapest possible authenticated call. Raises on bad credentials.

        Returns metadata about the account for display (the ``server_info``
        equivalent of an MCP handshake).
        """
        raise NotImplementedError

    async def call(self, tool_name: str, arguments: dict[str, Any]) -> Any:
        raise NotImplementedError
