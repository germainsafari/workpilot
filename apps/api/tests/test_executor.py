import pytest

from app.config import get_settings
from app.executor import ExecutionPolicyError, NativeExecutor
from app.models import Connection
from app.runtimes.bedrock_langgraph import evidence_insights
from app.schemas import CanonicalWorkflow, ToolStep
from app.tool_invoker import (
    McpToolInvoker,
    ToolPolicyError,
    UnboundToolInvoker,
    resolve_template,
)


@pytest.mark.asyncio
async def test_native_executor_runs_mock_condition_wait_tool_and_end() -> None:
    workflow = CanonicalWorkflow.model_validate(
        {
            "steps": [
                {"id": "extract", "name": "Extract brief", "type": "ai_task", "task": "extract"},
                {
                    "id": "check",
                    "name": "Check deadline",
                    "type": "condition",
                    "field": "missing_details",
                    "operator": "is_empty",
                },
                {"id": "wait", "name": "Wait", "type": "wait", "duration_seconds": 0},
                {
                    "id": "tasks",
                    "name": "Prepare tasks",
                    "type": "tool",
                    "operation": "prepare_tasks",
                    "dry_run": True,
                },
                {"id": "end", "name": "Finish", "type": "end"},
            ],
            "edges": [
                {"from": "extract", "to": "check"},
                {"from": "check", "to": "wait"},
                {"from": "wait", "to": "tasks"},
                {"from": "tasks", "to": "end"},
            ],
        }
    )
    results = await NativeExecutor().execute(workflow, {"client": "Northstar", "deadline": "2026-08-14"})
    assert [result.step_id for result in results] == ["extract", "check", "wait", "tasks", "end"]
    assert results[0].model_usage["provider"] == "deterministic_mock"


@pytest.mark.asyncio
async def test_unbound_tool_step_reports_not_configured_instead_of_fake_success() -> None:
    """A tool step with no connection must not look like it did something.

    The Phase-1 executor answered every tool step with
    ``{"prepared": True, "records_changed": 0}``, which read as a success in the
    UI even though nothing had been called.
    """
    workflow = CanonicalWorkflow.model_validate(
        {
            "steps": [
                {"id": "fetch", "name": "Fetch projects", "type": "tool", "operation": "fetch_records"},
                {"id": "end", "name": "Finish", "type": "end"},
            ],
            "edges": [{"from": "fetch", "to": "end"}],
        }
    )
    results = await NativeExecutor(tool_invoker=UnboundToolInvoker()).execute(workflow, {})
    output = results[0].output_data
    assert output["status"] == "skipped"
    assert "prepared" not in output
    assert results[0].tool_usage["invoked"] is False


@pytest.mark.asyncio
async def test_executor_threads_tool_output_into_the_next_step() -> None:
    """The AI step must see the previous step's real output, namespaced by id."""
    seen: dict[str, object] = {}

    class RecordingRuntime:
        @property
        def name(self) -> str:
            return "recording"

        async def execute(self, step, input_data):  # type: ignore[no-untyped-def]
            seen.update(input_data.get("_steps", {}))
            return {"ok": True}, {"provider": "recording", "cost_usd": 0.0}

    class Invoker:
        async def invoke(self, step, context):  # type: ignore[no-untyped-def]
            return {"status": "ok", "result": {"projects": [1, 2, 3]}}, {"invoked": True}

    workflow = CanonicalWorkflow.model_validate(
        {
            "steps": [
                {
                    "id": "fetchProjects",
                    "name": "Fetch projects",
                    "type": "tool",
                    "operation": "fetch_records",
                    "connection_id": "conn-1",
                    "tool_name": "list_projects",
                },
                {"id": "summarize", "name": "Summarize", "type": "ai_task", "task": "summarize"},
                {"id": "end", "name": "Finish", "type": "end"},
            ],
            "edges": [
                {"from": "fetchProjects", "to": "summarize"},
                {"from": "summarize", "to": "end"},
            ],
        }
    )
    await NativeExecutor(runtime=RecordingRuntime(), tool_invoker=Invoker()).execute(workflow, {})
    assert seen["fetchProjects"]["result"]["projects"] == [1, 2, 3]  # type: ignore[index]


# -- execution policy: reads run, writes are refused ----------------------


def _connection(catalog: list[dict[str, object]] | None = None) -> Connection:
    return Connection(
        id="conn-1",
        tenant_id="tenant-northstar",
        connector_id="scoro",
        name="Scoro",
        kind="mcp",
        base_url="https://acme.scoro.com/mcp",
        tool_catalog=catalog or [],
    )


def _invoker() -> McpToolInvoker:
    # _enforce_policy touches neither the session nor the network.
    return McpToolInvoker(session=None, tenant_id="tenant-northstar")  # type: ignore[arg-type]


def test_policy_refuses_a_step_declared_as_a_write() -> None:
    get_settings.cache_clear()
    step = ToolStep(
        id="create",
        name="Create project",
        type="tool",
        connection_id="conn-1",
        tool_name="create_project",
        mode="write",
    )
    with pytest.raises(ToolPolicyError, match="read-only mode"):
        _invoker()._enforce_policy(step, _connection())


def test_policy_refuses_a_mutating_tool_mislabelled_as_a_read() -> None:
    """A step cannot smuggle a write through by claiming mode='read'.

    The server's own catalog is consulted, so a tool the connection reports as
    mutating is refused regardless of how the step describes itself.
    """
    get_settings.cache_clear()
    step = ToolStep(
        id="sneaky",
        name="Totally a read",
        type="tool",
        connection_id="conn-1",
        tool_name="delete_project",
        mode="read",
    )
    catalog = [{"name": "delete_project", "read_only": False}]
    with pytest.raises(ToolPolicyError, match="mutating"):
        _invoker()._enforce_policy(step, _connection(catalog))


def test_policy_allows_a_read() -> None:
    get_settings.cache_clear()
    step = ToolStep(
        id="fetch",
        name="Fetch projects",
        type="tool",
        connection_id="conn-1",
        tool_name="list_projects",
        mode="read",
    )
    catalog = [{"name": "list_projects", "read_only": True}]
    _invoker()._enforce_policy(step, _connection(catalog))  # must not raise


def test_legacy_definitions_still_validate() -> None:
    """Stored Phase-1 definitions predate connection binding."""
    step = ToolStep(id="tasks", name="Prepare tasks", type="tool", operation="prepare_tasks")
    assert step.is_bound is False
    assert step.mode == "read"


# -- argument templating --------------------------------------------------


def test_resolve_template_preserves_type_for_whole_value_references() -> None:
    context = {"_steps": {"fetch": {"result": {"projects": [{"id": 7}]}}}}
    assert resolve_template("{{fetch.result.projects}}", context) == [{"id": 7}]
    assert resolve_template("{{fetch.result.projects.0.id}}", context) == 7


def test_resolve_template_interpolates_embedded_references() -> None:
    context = {"client": "Acme", "_steps": {}}
    assert resolve_template("Report for {{client}}", context) == "Report for Acme"


def test_resolve_template_missing_reference_is_none_not_a_crash() -> None:
    assert resolve_template("{{nope.missing}}", {"_steps": {}}) is None


def test_resolve_template_recurses_into_containers() -> None:
    context = {"_steps": {"fetch": {"id": 42}}}
    resolved = resolve_template({"ids": ["{{fetch.id}}"], "keep": 5}, context)
    assert resolved == {"ids": [42], "keep": 5}


def test_execution_policy_error_is_still_exported() -> None:
    """Cycle detection continues to raise it; keep the symbol stable."""
    assert issubclass(ExecutionPolicyError, RuntimeError)


def test_evidence_insights_flags_open_overdue_records() -> None:
    insight = evidence_insights(
        {
            "_steps": {
                "fetch": {
                    "result": {
                        "projects": [
                            {
                                "project_name": "Late launch",
                                "status": "pending",
                                "deadline": "2020-01-01",
                            },
                            {
                                "project_name": "Delivered",
                                "status": "completed",
                                "deadline": "2020-01-01",
                            },
                        ]
                    }
                }
            }
        }
    )
    assert insight["status_breakdown"] == {"completed": 1, "pending": 1}
    assert insight["summary"] == "Analyzed 2 records: 1 completed, 1 pending. 1 item needs review."
    assert insight["attention_total"] == 1
    assert insight["needs_attention"][0]["item"] == "Late launch"
