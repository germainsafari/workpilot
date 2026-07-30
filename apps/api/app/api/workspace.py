"""The current workspace (tenant) and its settings.

A principal belongs to exactly one tenant, so this router deliberately exposes
no tenant *switching* — only the current workspace's detail, a rename, and the
settings document. The sidebar "switcher" is therefore a detail panel, and the
UI says so rather than implying other workspaces exist.

Settings live in ``tenants.settings`` (a JSON column) instead of a table of
their own: they are a small, read-mostly, one-row-per-tenant document, and a
table would cost a migration and a join for nothing. Writes merge over whatever
is already stored so keys owned by other parts of the product (the demo seed
writes ``default_timezone`` and friends) survive a save from this screen.

``allow_tool_writes`` is reported but never accepted. Whether WorkPilot may
perform live writes against a customer's systems is a deployment decision made
with ``WORKPILOT_ALLOW_TOOL_WRITES``; letting a workspace admin flip it from a
settings page would turn a server-side safety policy into a checkbox.
"""

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.audit import record_audit
from app.auth import Principal, active_principal
from app.config import get_settings
from app.db import get_session
from app.models import Tenant, User, Workflow
from app.schemas import (
    WorkspaceRead,
    WorkspaceSettingsRead,
    WorkspaceSettingsUpdate,
    WorkspaceUpdate,
)

router = APIRouter(prefix="/workspace", tags=["Workspace"])

# Defaults for every key this screen owns. ``data_region`` is absent because its
# default is the tenant's own column, not a constant.
SETTINGS_DEFAULTS: dict[str, object] = {
    "require_approval_for_writes": True,
    "max_run_cost_usd": 1.0,
    "notify_on_run_failure": True,
    "notify_on_approval_needed": True,
    "notify_email": "",
    "retain_run_days": 90,
}


def _require_admin(principal: Principal) -> None:
    if principal.role != "workflow_admin":
        raise HTTPException(
            status_code=403,
            detail="Only a Workflow Admin can change workspace settings.",
        )


async def _load(session: AsyncSession, principal: Principal) -> Tenant:
    tenant = await session.scalar(select(Tenant).where(Tenant.id == principal.tenant_id))
    if tenant is None:
        raise HTTPException(status_code=404, detail="Workspace not found")
    return tenant


async def _count(session: AsyncSession, model: type[User] | type[Workflow], tenant_id: str) -> int:
    return (
        await session.scalar(
            select(func.count()).select_from(model).where(model.tenant_id == tenant_id)
        )
    ) or 0


async def _to_read(session: AsyncSession, tenant: Tenant) -> WorkspaceRead:
    return WorkspaceRead(
        id=tenant.id,
        name=tenant.name,
        slug=tenant.slug,
        plan=tenant.plan,
        data_region=tenant.data_region,
        member_count=await _count(session, User, tenant.id),
        workflow_count=await _count(session, Workflow, tenant.id),
    )


@router.get("/available", response_model=list[WorkspaceRead])
async def list_available_workspaces(
    principal: Principal = Depends(active_principal),
    session: AsyncSession = Depends(get_session),
) -> list[WorkspaceRead]:
    """Workspaces this signed-in account may switch to.

    Membership is represented by the tenant-scoped user row. Matching by the
    verified account email lets one Cognito identity hold a different role in
    each workspace without weakening tenant isolation.
    """
    current_user = await session.scalar(
        select(User).where(
            User.id == principal.user_id,
            User.tenant_id == principal.tenant_id,
        )
    )
    email = principal.email or (current_user.email if current_user else None)
    tenant_ids = {principal.tenant_id}
    if email:
        memberships = await session.scalars(
            select(User.tenant_id).where(
                func.lower(User.email) == email.lower(),
                User.status == "active",
            )
        )
        tenant_ids.update(memberships)
    tenants = await session.scalars(
        select(Tenant).where(Tenant.id.in_(tenant_ids)).order_by(Tenant.name)
    )
    return [await _to_read(session, tenant) for tenant in tenants]


def _effective_settings(tenant: Tenant) -> WorkspaceSettingsRead:
    stored = {**SETTINGS_DEFAULTS, "data_region": tenant.data_region, **(tenant.settings or {})}
    return WorkspaceSettingsRead(
        # Server-controlled, not tenant-controlled — see the module docstring.
        allow_tool_writes=get_settings().allow_tool_writes,
        require_approval_for_writes=bool(stored["require_approval_for_writes"]),
        max_run_cost_usd=float(str(stored["max_run_cost_usd"])),
        data_region=str(stored["data_region"] or tenant.data_region),
        notify_on_run_failure=bool(stored["notify_on_run_failure"]),
        notify_on_approval_needed=bool(stored["notify_on_approval_needed"]),
        notify_email=str(stored["notify_email"] or ""),
        retain_run_days=int(str(stored["retain_run_days"])),
    )


@router.get("", response_model=WorkspaceRead)
async def get_workspace(
    principal: Principal = Depends(active_principal),
    session: AsyncSession = Depends(get_session),
) -> WorkspaceRead:
    return await _to_read(session, await _load(session, principal))


@router.patch("", response_model=WorkspaceRead)
async def rename_workspace(
    payload: WorkspaceUpdate,
    principal: Principal = Depends(active_principal),
    session: AsyncSession = Depends(get_session),
) -> WorkspaceRead:
    _require_admin(principal)
    """Rename only. The slug is immutable — stored references point at it."""
    tenant = await _load(session, principal)
    previous = tenant.name
    tenant.name = payload.name
    await record_audit(
        session,
        principal,
        "workspace.renamed",
        "tenant",
        tenant.id,
        {"from": previous, "to": tenant.name},
    )
    await session.commit()
    await session.refresh(tenant)
    return await _to_read(session, tenant)


@router.get("/settings", response_model=WorkspaceSettingsRead)
async def get_workspace_settings(
    principal: Principal = Depends(active_principal),
    session: AsyncSession = Depends(get_session),
) -> WorkspaceSettingsRead:
    return _effective_settings(await _load(session, principal))


@router.put("/settings", response_model=WorkspaceSettingsRead)
async def put_workspace_settings(
    payload: WorkspaceSettingsUpdate,
    principal: Principal = Depends(active_principal),
    session: AsyncSession = Depends(get_session),
) -> WorkspaceSettingsRead:
    _require_admin(principal)
    tenant = await _load(session, principal)
    changes = payload.model_dump(exclude_unset=True, exclude_none=True)

    # Reassign rather than mutate: SQLAlchemy does not track in-place edits to a
    # plain JSON column, so an in-place update would never be persisted.
    tenant.settings = {**(tenant.settings or {}), **changes}
    # data_region is mirrored onto the column so the rest of the app (and the
    # workspace detail panel) reads one value, not two that can disagree.
    if "data_region" in changes:
        tenant.data_region = str(changes["data_region"])

    await record_audit(
        session, principal, "workspace.settings_updated", "tenant", tenant.id, changes
    )
    await session.commit()
    await session.refresh(tenant)
    return _effective_settings(tenant)
