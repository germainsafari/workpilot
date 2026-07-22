import pytest
from pydantic import ValidationError

from app.schemas import CanonicalWorkflow


def test_canonical_workflow_validates_connected_graph() -> None:
    workflow = CanonicalWorkflow.model_validate(
        {
            "apiVersion": "workpilot.io/v1",
            "kind": "Workflow",
            "steps": [
                {"id": "wait", "name": "Wait briefly", "type": "wait", "duration_seconds": 0},
                {"id": "end", "name": "Finish", "type": "end"},
            ],
            "edges": [{"from": "wait", "to": "end"}],
        }
    )
    assert workflow.steps[0].id == "wait"


def test_canonical_workflow_rejects_unreachable_step() -> None:
    with pytest.raises(ValidationError, match="unreachable steps"):
        CanonicalWorkflow.model_validate(
            {
                "steps": [
                    {"id": "start", "name": "Start", "type": "wait"},
                    {"id": "orphan", "name": "Orphan", "type": "wait"},
                    {"id": "end", "name": "Finish", "type": "end"},
                ],
                "edges": [{"from": "start", "to": "end"}],
            }
        )


def test_canonical_workflow_requires_end_step() -> None:
    with pytest.raises(ValidationError, match="end step"):
        CanonicalWorkflow.model_validate({"steps": [{"id": "wait", "name": "Wait", "type": "wait"}]})
