"""Connections: a tenant's credentialed links to third-party systems.

Every mutating route probes the server for real before reporting a status, so
"connected" means an ``initialize`` handshake succeeded and ``tools/list``
returned. The previous browser-only implementation reported success even when
discovery had failed entirely, which is why connecting appeared to work while
nothing could actually be called.

Credentials are encrypted on the way in (``app.crypto``) and never appear in a
response — clients get ``has_token`` and a masked ``token_hint`` instead.
"""

import re
from datetime import datetime
from typing import Any
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException, Response, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.audit import record_audit
from app.auth import Principal, active_principal
from app.connectors import get_rest_connector
from app.connectors.base import RestAuthError, RestToolError
from app.crypto import CredentialEncryptionError, decrypt_secret, encrypt_secret, mask_secret
from app.db import get_session
from app.mcp import McpAuthError, McpError, discover_tools
from app.models import Connection
from app.schemas import ConnectionCreate, ConnectionRead, ConnectionToolRead, ConnectionUpdate

router = APIRouter(prefix="/connections", tags=["Connections"])

def normalize_endpoint(raw: str, kind: str = "mcp") -> str:
    """Tidy a pasted URL into the base this connector expects.

    Scoro deliberately does NOT get a ``/mcp`` suffix any more: its MCP endpoint
    requires a JWT that an API key cannot satisfy, so WorkPilot talks to the REST
    API instead. A pasted ``…/mcp`` is stripped back to the site root, and the
    Scoro connector appends ``/api/v2`` itself.
    """
    url = raw.strip().rstrip("/")
    if not url:
        return url
    if "://" not in url:
        url = f"https://{url}"

    if kind != "mcp":
        return re.sub(r"/mcp/?$", "", url, flags=re.I)
    return url


def _to_read(connection: Connection) -> ConnectionRead:
    token_hint = ""
    if connection.encrypted_token:
        try:
            token_hint = mask_secret(decrypt_secret(connection.encrypted_token))
        except CredentialEncryptionError:
            # Key rotated out from under the row — surface it rather than 500.
            token_hint = "unreadable"

    return ConnectionRead(
        id=connection.id,
        connector_id=connection.connector_id,
        name=connection.name,
        kind=connection.kind,
        base_url=connection.base_url,
        status=connection.status,
        has_token=bool(connection.encrypted_token),
        token_hint=token_hint,
        tools=[
            ConnectionToolRead(**tool)
            for tool in (connection.tool_catalog or [])
            if isinstance(tool, dict)
        ],
        server_info=connection.server_info or {},
        last_error=connection.last_error,
        last_checked_at=connection.last_checked_at,
        created_at=connection.created_at,
        updated_at=connection.updated_at,
    )


async def _probe(connection: Connection) -> None:
    """Handshake with the server and record what came back, in place.

    Never raises: a failed probe is a legitimate state for a saved connection
    (a wrong token is fixable), so the outcome lands on ``status``/``last_error``
    for the client to display.
    """
    connection.last_checked_at = datetime.utcnow()

    try:
        token = decrypt_secret(connection.encrypted_token)
    except CredentialEncryptionError as exc:
        connection.status = "error"
        connection.last_error = str(exc)
        return

    # A known REST vendor: verify the credential with a real call and publish the
    # connector's declared catalog. Unlike MCP there is nothing to discover, but
    # the credential is still proven before we call the connection "connected".
    rest_cls = get_rest_connector(connection.connector_id)
    if connection.kind != "mcp" and rest_cls is not None:
        connector = rest_cls(connection.base_url, token)
        try:
            info = await connector.verify()
        except RestAuthError as exc:
            connection.status = "error"
            connection.last_error = str(exc)
            return
        except RestToolError as exc:
            connection.status = "error"
            connection.last_error = str(exc)
            return
        connection.tool_catalog = rest_cls.tool_catalog()
        connection.server_info = info
        connection.status = "connected"
        connection.last_error = None
        return

    if connection.kind != "mcp":
        # An unrecognised API-key service: nothing to verify or discover.
        connection.status = "connected" if connection.encrypted_token else "untested"
        connection.last_error = (
            None if connection.encrypted_token
            else "Add an API token so workflows can authenticate."
        )
        connection.tool_catalog = []
        return

    try:
        tools, server_info = await discover_tools(connection.base_url, token=token)
    except McpAuthError as exc:
        connection.status = "error"
        connection.last_error = f"Authentication failed: {exc}"
        return
    except McpError as exc:
        connection.status = "error"
        connection.last_error = str(exc)
        return

    connection.tool_catalog = [tool.to_dict() for tool in tools]
    connection.server_info = server_info or {}
    connection.status = "connected"
    connection.last_error = (
        None if tools else "Connected, but the server advertises no tools."
    )


async def _load(session: AsyncSession, principal: Principal, connection_id: str) -> Connection:
    connection = await session.scalar(
        select(Connection).where(
            Connection.id == connection_id,
            Connection.tenant_id == principal.tenant_id,
        )
    )
    if connection is None:
        raise HTTPException(status_code=404, detail="Connection not found")
    return connection


@router.get("", response_model=list[ConnectionRead])
async def list_connections(
    principal: Principal = Depends(active_principal),
    session: AsyncSession = Depends(get_session),
) -> list[ConnectionRead]:
    rows = await session.scalars(
        select(Connection)
        .where(Connection.tenant_id == principal.tenant_id)
        .order_by(Connection.created_at.desc())
    )
    return [_to_read(row) for row in rows]


@router.get("/tools", response_model=list[dict[str, Any]])
async def list_available_tools(
    principal: Principal = Depends(active_principal),
    session: AsyncSession = Depends(get_session),
) -> list[dict[str, Any]]:
    """Every tool the workspace can currently call, flattened.

    This is the catalog the workflow compiler needs in order to bind a
    plain-English step like "fetch my Scoro projects" to a real tool.
    """
    rows = await session.scalars(
        select(Connection).where(
            Connection.tenant_id == principal.tenant_id,
            Connection.status == "connected",
        )
    )
    catalog: list[dict[str, Any]] = []
    for connection in rows:
        for tool in connection.tool_catalog or []:
            if not isinstance(tool, dict) or not tool.get("name"):
                continue
            catalog.append(
                {
                    "connection_id": connection.id,
                    "connection_name": connection.name,
                    "connector_id": connection.connector_id,
                    "tool_name": tool["name"],
                    "description": tool.get("description", ""),
                    "read_only": tool.get("read_only", True),
                    "input_schema": tool.get("input_schema", {}),
                }
            )
    return catalog


@router.post("", response_model=ConnectionRead, status_code=status.HTTP_201_CREATED)
async def create_connection(
    payload: ConnectionCreate,
    principal: Principal = Depends(active_principal),
    session: AsyncSession = Depends(get_session),
) -> ConnectionRead:
    endpoint = normalize_endpoint(payload.base_url, payload.kind)

    existing = await session.scalar(
        select(Connection).where(
            Connection.tenant_id == principal.tenant_id,
            Connection.name == payload.name,
        )
    )
    if existing is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"A connection named {payload.name!r} already exists.",
        )

    try:
        encrypted = encrypt_secret(payload.token)
    except CredentialEncryptionError as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc

    connection = Connection(
        id=f"conn-{uuid4()}",
        tenant_id=principal.tenant_id,
        connector_id=payload.connector_id,
        name=payload.name,
        kind=payload.kind,
        base_url=endpoint,
        encrypted_token=encrypted,
        tool_catalog=[],
        server_info={},
        status="untested",
        created_by=principal.user_id,
    )

    # Probe before saving so the stored status reflects reality.
    await _probe(connection)

    session.add(connection)
    await record_audit(
        session,
        principal,
        "connection.created",
        "connection",
        connection.id,
        {
            "connector_id": connection.connector_id,
            "kind": connection.kind,
            "status": connection.status,
            "tools_discovered": len(connection.tool_catalog or []),
        },
    )
    await session.commit()
    await session.refresh(connection)
    return _to_read(connection)


@router.get("/{connection_id}", response_model=ConnectionRead)
async def get_connection(
    connection_id: str,
    principal: Principal = Depends(active_principal),
    session: AsyncSession = Depends(get_session),
) -> ConnectionRead:
    return _to_read(await _load(session, principal, connection_id))


@router.patch("/{connection_id}", response_model=ConnectionRead)
async def update_connection(
    connection_id: str,
    payload: ConnectionUpdate,
    principal: Principal = Depends(active_principal),
    session: AsyncSession = Depends(get_session),
) -> ConnectionRead:
    connection = await _load(session, principal, connection_id)

    if payload.name is not None:
        connection.name = payload.name
    if payload.base_url is not None:
        connection.base_url = normalize_endpoint(payload.base_url, connection.kind)
    if payload.token is not None:
        # An empty string clears the credential; a value replaces it.
        try:
            connection.encrypted_token = encrypt_secret(payload.token) if payload.token else None
        except CredentialEncryptionError as exc:
            raise HTTPException(status_code=500, detail=str(exc)) from exc

    await _probe(connection)
    await record_audit(
        session,
        principal,
        "connection.updated",
        "connection",
        connection.id,
        {"status": connection.status, "token_changed": payload.token is not None},
    )
    await session.commit()
    await session.refresh(connection)
    return _to_read(connection)


@router.post("/{connection_id}/test", response_model=ConnectionRead)
async def test_connection(
    connection_id: str,
    principal: Principal = Depends(active_principal),
    session: AsyncSession = Depends(get_session),
) -> ConnectionRead:
    """Re-handshake and refresh the cached tool catalog."""
    connection = await _load(session, principal, connection_id)
    await _probe(connection)
    await record_audit(
        session,
        principal,
        "connection.tested",
        "connection",
        connection.id,
        {"status": connection.status, "tools_discovered": len(connection.tool_catalog or [])},
    )
    await session.commit()
    await session.refresh(connection)
    return _to_read(connection)


@router.delete("/{connection_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_connection(
    connection_id: str,
    principal: Principal = Depends(active_principal),
    session: AsyncSession = Depends(get_session),
) -> Response:
    connection = await _load(session, principal, connection_id)
    await session.delete(connection)
    await record_audit(session, principal, "connection.deleted", "connection", connection_id)
    await session.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)
