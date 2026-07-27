"""Resolve authenticated principals to persisted tenant users."""

from __future__ import annotations

from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import Principal
from app.models import Tenant, User


async def ensure_principal_user(session: AsyncSession, principal: Principal) -> User:
    """Ensure the signed-in principal has a row in ``users`` (required for workflow FKs).

    Local stub auth uses seeded ids such as ``user-alex``. Cognito JWTs use the
    pool ``sub``, which is provisioned on first write.
    """
    existing = await session.get(User, principal.user_id)
    if existing is not None:
        return existing

    tenant = await session.get(Tenant, principal.tenant_id)
    if tenant is None:
        raise ValueError(f"Unknown tenant: {principal.tenant_id}")

    display_name = principal.name or principal.email or "WorkPilot user"
    email = principal.email or f"{principal.user_id}@users.workpilot.local"

    user = User(
        id=principal.user_id,
        tenant_id=principal.tenant_id,
        email=email,
        name=display_name[:180],
        role=principal.role,
    )
    session.add(user)
    try:
        await session.flush()
    except IntegrityError:
        await session.rollback()
        existing = await session.get(User, principal.user_id)
        if existing is not None:
            return existing
        raise
    return user
