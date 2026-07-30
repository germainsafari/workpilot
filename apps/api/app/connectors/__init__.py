"""Connectors: how WorkPilot reaches a third-party system.

Two transports exist because real business systems are split between them:

* **MCP** (``app.mcp``) — self-describing. One handshake yields the tool catalog.
* **REST** (this package) — the common case. Each vendor has its own auth style
  and URL conventions, so a connector declares its tool catalog explicitly.

Scoro is why this package exists. Its ``/mcp`` endpoint sits behind an APISIX
gateway that demands a JWT, so a Scoro API key authenticates there with
``401 invalid jwt``. The same key works immediately against the REST API v2.
"""

from app.connectors.base import RestConnector, RestToolError
from app.connectors.scoro import ScoroConnector

# Registry keyed by the value stored in ``Connection.connector_id``.
REST_CONNECTORS: dict[str, type[RestConnector]] = {
    "scoro": ScoroConnector,
}


def get_rest_connector(connector_id: str) -> type[RestConnector] | None:
    return REST_CONNECTORS.get((connector_id or "").strip().lower())


__all__ = [
    "REST_CONNECTORS",
    "RestConnector",
    "RestToolError",
    "ScoroConnector",
    "get_rest_connector",
]
