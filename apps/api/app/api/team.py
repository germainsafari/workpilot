"""Team membership: the workspace's people, their roles, and invitations.

Backed by the existing ``users`` table rather than a parallel "team member"
table — a team member *is* a tenant user, and a second table would only let the
two drift. Before this router the Team screen rendered four hardcoded fictional
people and the row menu did nothing, so membership had no server-side existence
at all.

Two changes are refused rather than performed, both protecting the same
invariant — a workspace must always keep at least one person who can administer
it, and you must not be able to revoke your own access:

* removing (or demoting, or suspending) the last remaining ``workflow_admin``
* removing yourself

Both return 409 with an explanation the UI shows verbatim.
"""

from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException, Response, status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.audit import record_audit
from app.auth import Principal, active_principal
from app.db import get_session
from app.models import User, Workflow
from app.schemas import TeamMemberCreate, TeamMemberRead, TeamMemberUpdate

router = APIRouter(prefix="/team", tags=["Team"])

ADMIN_ROLE = "workflow_admin"


def _require_admin(principal: Principal) -> None:
    if principal.role != ADMIN_ROLE:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only a Workflow Admin can change team membership or roles.",
        )


async def _load(session: AsyncSession, principal: Principal, user_id: str) -> User:
    user = await session.scalar(
        select(User).where(User.id == user_id, User.tenant_id == principal.tenant_id)
    )
    if user is None:
        raise HTTPException(status_code=404, detail="Team member not found")
    return user


async def _admin_count(session: AsyncSession, tenant_id: str) -> int:
    return (
        await session.scalar(
            select(func.count())
            .select_from(User)
            .where(User.tenant_id == tenant_id, User.role == ADMIN_ROLE)
        )
    ) or 0


async def _guard_last_admin(session: AsyncSession, user: User, action: str) -> None:
    """Refuse a change that would leave the workspace with no administrator."""
    if user.role != ADMIN_ROLE:
        return
    if await _admin_count(session, user.tenant_id) > 1:
        return
    raise HTTPException(
        status_code=status.HTTP_409_CONFLICT,
        detail=(
            f"Cannot {action} {user.name or user.email}: they are the last workflow_admin "
            "in this workspace. Promote someone else to workflow_admin first."
        ),
    )


@router.get("", response_model=list[TeamMemberRead])
async def list_team(
    principal: Principal = Depends(active_principal),
    session: AsyncSession = Depends(get_session),
) -> list[TeamMemberRead]:
    rows = await session.scalars(
        select(User).where(User.tenant_id == principal.tenant_id).order_by(User.name)
    )
    return [TeamMemberRead.model_validate(row) for row in rows]


@router.post("", response_model=TeamMemberRead, status_code=status.HTTP_201_CREATED)
async def invite_member(
    payload: TeamMemberCreate,
    principal: Principal = Depends(active_principal),
    session: AsyncSession = Depends(get_session),
) -> TeamMemberRead:
    _require_admin(principal)
    """Create an invited member. No email is sent — there is no mail transport yet."""
    existing = await session.scalar(
        select(User).where(
            User.tenant_id == principal.tenant_id,
            func.lower(User.email) == payload.email.lower(),
        )
    )
    if existing is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"{payload.email} is already a member of this workspace.",
        )

    user = User(
        id=f"user-{uuid4()}",
        tenant_id=principal.tenant_id,
        email=payload.email,
        name=payload.name,
        role=payload.role,
        status="invited",
    )
    session.add(user)
    await record_audit(
        session,
        principal,
        "team.invited",
        "user",
        user.id,
        {"email": user.email, "role": user.role},
    )
    await session.commit()
    await session.refresh(user)
    return TeamMemberRead.model_validate(user)


@router.patch("/{user_id}", response_model=TeamMemberRead)
async def update_member(
    user_id: str,
    payload: TeamMemberUpdate,
    principal: Principal = Depends(active_principal),
    session: AsyncSession = Depends(get_session),
) -> TeamMemberRead:
    _require_admin(principal)
    user = await _load(session, principal, user_id)

    # Losing admin rights and losing the ability to sign in both end the
    # workspace's last administrator, so both are guarded.
    if payload.role is not None and payload.role != ADMIN_ROLE:
        await _guard_last_admin(session, user, "change the role of")
    if payload.status is not None and payload.status != "active":
        await _guard_last_admin(session, user, f"set {payload.status} on")

    if payload.name is not None:
        user.name = payload.name
    if payload.role is not None:
        user.role = payload.role
    if payload.status is not None:
        user.status = payload.status

    await record_audit(
        session,
        principal,
        "team.updated",
        "user",
        user.id,
        payload.model_dump(exclude_unset=True),
    )
    await session.commit()
    await session.refresh(user)
    return TeamMemberRead.model_validate(user)


@router.delete("/{user_id}", status_code=status.HTTP_204_NO_CONTENT)
async def remove_member(
    user_id: str,
    principal: Principal = Depends(active_principal),
    session: AsyncSession = Depends(get_session),
) -> Response:
    _require_admin(principal)
    user = await _load(session, principal, user_id)

    if user.id == principal.user_id:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="You cannot remove yourself from the workspace. Ask another admin to do it.",
        )
    await _guard_last_admin(session, user, "remove")

    # workflows.owner_id references users.id, so deleting an owner would raise a
    # foreign-key error deep in the flush. Refusing up front gives the UI
    # something it can actually explain to the person clicking Remove.
    owned = (
        await session.scalar(
            select(func.count())
            .select_from(Workflow)
            .where(Workflow.tenant_id == principal.tenant_id, Workflow.owner_id == user.id)
        )
    ) or 0
    if owned:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=(
                f"{user.name or user.email} still owns {owned} workflow(s). "
                "Reassign them first, or set this member to suspended instead."
            ),
        )

    await session.delete(user)
    await record_audit(
        session,
        principal,
        "team.removed",
        "user",
        user_id,
        {"email": user.email, "role": user.role},
    )
    await session.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)
