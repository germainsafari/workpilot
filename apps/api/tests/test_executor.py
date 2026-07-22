import pytest

from app.executor import ExecutionPolicyError, NativeExecutor
from app.schemas import CanonicalWorkflow


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
    assert results[3].output_data["records_changed"] == 0


@pytest.mark.asyncio
async def test_native_executor_blocks_live_write() -> None:
    workflow = CanonicalWorkflow.model_validate(
        {
            "steps": [
                {
                    "id": "tasks",
                    "name": "Create tasks",
                    "type": "tool",
                    "operation": "prepare_tasks",
                    "dry_run": False,
                },
                {"id": "end", "name": "Finish", "type": "end"},
            ],
            "edges": [{"from": "tasks", "to": "end"}],
        }
    )
    with pytest.raises(ExecutionPolicyError, match="live external writes"):
        await NativeExecutor().execute(workflow, {})
