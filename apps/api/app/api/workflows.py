from datetime import datetime
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException, Response, status
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.audit import record_audit
from app.auth import Principal, active_principal
from app.authoring import (
    CompileRequest,
    CompileResponse,
    WorkflowDetailWithExplanation,
    build_explanation,
    compile_description,
    cost_estimate,
    explanation_summary,
    load_tool_catalog,
)
from app.db import get_session
from app.models import Workflow, WorkflowVersion
from app.schemas import CanonicalWorkflow, WorkflowCreate, WorkflowRead, WorkflowUpdate
from app.users import ensure_principal_user

router = APIRouter(prefix="/workflows", tags=["Workflows"])


def explanation_for(definition: CanonicalWorkflow) -> str:
    """The one-line explanation persisted on the version row.

    The structured version — the one the UI renders — is built on read by
    ``app.authoring.build_explanation``, because it needs the tool catalog and
    the run history, neither of which is known at write time.
    """
    return explanation_summary(definition)


@router.get("", response_model=list[WorkflowRead])
async def list_workflows(
    principal: Principal = Depends(active_principal), session: AsyncSession = Depends(get_session)
) -> list[Workflow]:
    result = await session.scalars(
        select(Workflow).where(Workflow.tenant_id == principal.tenant_id).order_by(Workflow.updated_at.desc())
    )
    return list(result)


@router.post("", response_model=WorkflowRead, status_code=status.HTTP_201_CREATED)
async def create_workflow(
    payload: WorkflowCreate,
    principal: Principal = Depends(active_principal),
    session: AsyncSession = Depends(get_session),
) -> Workflow:
    try:
        await ensure_principal_user(session, principal)
    except ValueError as error:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(error)) from error

    workflow_id = f"wf-{uuid4()}"
    version_id = f"version-{uuid4()}"
    workflow = Workflow(
        id=workflow_id,
        tenant_id=principal.tenant_id,
        name=payload.name,
        description=payload.description,
        status="draft",
        active_version_id=version_id,
        owner_id=principal.user_id,
        department=payload.department,
        risk_level=payload.risk_level,
    )
    version = WorkflowVersion(
        id=version_id,
        workflow_id=workflow_id,
        version_number=1,
        canonical_definition=payload.definition.model_dump(by_alias=True),
        generated_explanation=explanation_for(payload.definition),
        validation_result={"valid": True, "errors": []},
        runtime_plan={"primary_runtime": "native", "safe_test": True},
        created_by=principal.user_id,
    )
    session.add_all([workflow, version])
    await record_audit(
        session, principal, "workflow.created", "workflow", workflow_id, {"version_id": version_id}
    )
    await session.commit()
    await session.refresh(workflow)
    return workflow


@router.post("/compile", response_model=CompileResponse)
async def compile_workflow(
    payload: CompileRequest,
    principal: Principal = Depends(active_principal),
    session: AsyncSession = Depends(get_session),
) -> CompileResponse:
    """Compile a plain-English description into a validated canonical workflow.

    Always returns a workflow that passes ``CanonicalWorkflow`` validation. When
    the model could not produce one, ``ai_compiled`` is false and
    ``compile_error`` says why — the caller is never handed a fallback dressed up
    as the model's work.
    """
    catalog = await load_tool_catalog(session, principal.tenant_id)
    return await compile_description(payload.description, catalog)


@router.get("/{workflow_id}", response_model=WorkflowDetailWithExplanation)
async def get_workflow(
    workflow_id: str,
    principal: Principal = Depends(active_principal),
    session: AsyncSession = Depends(get_session),
) -> WorkflowDetailWithExplanation:
    workflow = await session.scalar(
        select(Workflow)
        .where(Workflow.id == workflow_id, Workflow.tenant_id == principal.tenant_id)
        .options(selectinload(Workflow.versions))
    )
    if workflow is None:
        raise HTTPException(status_code=404, detail="Workflow not found")
    version = next((item for item in workflow.versions if item.id == workflow.active_version_id), None)
    if version is None:
        raise HTTPException(status_code=409, detail="Workflow has no active version")
    definition = CanonicalWorkflow.model_validate(version.canonical_definition)
    catalog = await load_tool_catalog(session, principal.tenant_id)
    cost = await cost_estimate(session, principal.tenant_id, workflow_id)
    return WorkflowDetailWithExplanation(
        **WorkflowRead.model_validate(workflow).model_dump(),
        version_number=version.version_number,
        definition=definition,
        explanation=version.generated_explanation,
        explanation_detail=build_explanation(definition, catalog, cost),
        validation_result=version.validation_result,
        runtime_plan=version.runtime_plan,
    )


@router.patch("/{workflow_id}", response_model=WorkflowRead)
async def update_workflow(
    workflow_id: str,
    payload: WorkflowUpdate,
    principal: Principal = Depends(active_principal),
    session: AsyncSession = Depends(get_session),
) -> Workflow:
    workflow = await session.scalar(
        select(Workflow).where(Workflow.id == workflow_id, Workflow.tenant_id == principal.tenant_id)
    )
    if workflow is None:
        raise HTTPException(status_code=404, detail="Workflow not found")
    changes = payload.model_dump(exclude_none=True)
    for key, value in changes.items():
        setattr(workflow, key, value)
    workflow.updated_at = datetime.utcnow()
    await record_audit(
        session, principal, "workflow.updated", "workflow", workflow_id, {"fields": sorted(changes)}
    )
    await session.commit()
    await session.refresh(workflow)
    return workflow


@router.delete("/{workflow_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_workflow(
    workflow_id: str,
    principal: Principal = Depends(active_principal),
    session: AsyncSession = Depends(get_session),
) -> Response:
    workflow = await session.scalar(
        select(Workflow).where(Workflow.id == workflow_id, Workflow.tenant_id == principal.tenant_id)
    )
    if workflow is None:
        raise HTTPException(status_code=404, detail="Workflow not found")
    await session.execute(delete(WorkflowVersion).where(WorkflowVersion.workflow_id == workflow_id))
    await session.delete(workflow)
    await record_audit(session, principal, "workflow.deleted", "workflow", workflow_id)
    await session.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)
