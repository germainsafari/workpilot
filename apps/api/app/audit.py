import hashlib
import json
from typing import Any
from uuid import uuid4

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import Principal
from app.models import AuditEvent


async def record_audit(
    session: AsyncSession,
    principal: Principal,
    action: str,
    resource_type: str,
    resource_id: str,
    metadata: dict[str, Any] | None = None,
) -> AuditEvent:
    payload = metadata or {}
    previous = await session.scalar(
        select(AuditEvent.immutable_hash)
        .where(AuditEvent.tenant_id == principal.tenant_id)
        .order_by(AuditEvent.timestamp.desc())
        .limit(1)
    )
    canonical = json.dumps(payload, sort_keys=True, separators=(",", ":"))
    immutable_hash = hashlib.sha256(
        f"{previous or 'genesis'}:{action}:{resource_type}:{resource_id}:{canonical}".encode()
    ).hexdigest()
    event = AuditEvent(
        id=f"audit-{uuid4()}",
        tenant_id=principal.tenant_id,
        actor_type="user",
        actor_id=principal.user_id,
        action=action,
        resource_type=resource_type,
        resource_id=resource_id,
        metadata_=payload,
        immutable_hash=immutable_hash,
    )
    session.add(event)
    return event
