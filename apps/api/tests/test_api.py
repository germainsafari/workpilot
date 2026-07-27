from fastapi.testclient import TestClient


def workflow_payload(name: str = "Test workflow") -> dict:
    return {
        "name": name,
        "description": "A tenant-scoped test process",
        "department": "Operations",
        "risk_level": "low",
        "definition": {
            "apiVersion": "workpilot.io/v1",
            "kind": "Workflow",
            "trigger": {"type": "manual", "label": "Someone starts it"},
            "steps": [
                {"id": "wait", "name": "Wait", "type": "wait", "duration_seconds": 0},
                {"id": "end", "name": "Finish", "type": "end"},
            ],
            "edges": [{"from": "wait", "to": "end"}],
        },
    }


def test_health_and_openapi(client: TestClient) -> None:
    assert client.get("/health").json()["status"] == "ok"
    openapi = client.get("/openapi.json")
    assert openapi.status_code == 200
    assert "/v1/workflows" in openapi.json()["paths"]


def test_workflow_crud_and_tenant_isolation(client: TestClient) -> None:
    created = client.post("/v1/workflows", json=workflow_payload()).json()
    workflow_id = created["id"]
    fetched = client.get(f"/v1/workflows/{workflow_id}")
    assert fetched.status_code == 200
    assert fetched.json()["definition"]["apiVersion"] == "workpilot.io/v1"
    updated = client.patch(f"/v1/workflows/{workflow_id}", json={"name": "Updated workflow"})
    assert updated.status_code == 200
    assert updated.json()["name"] == "Updated workflow"
    hidden = client.get(f"/v1/workflows/{workflow_id}", headers={"X-WorkPilot-Tenant-ID": "tenant-other"})
    assert hidden.status_code == 404
    deleted = client.delete(f"/v1/workflows/{workflow_id}")
    assert deleted.status_code == 204


def test_create_workflow_provisions_unknown_user(client: TestClient) -> None:
    """Cognito subs are not pre-seeded; the first create should provision the user row."""
    response = client.post(
        "/v1/workflows",
        json=workflow_payload("Provisioned user workflow"),
        headers={
            "X-WorkPilot-Tenant-ID": "tenant-northstar",
            "X-WorkPilot-User-ID": "user-cognito-new",
        },
    )
    assert response.status_code == 201
    assert response.json()["owner_id"] == "user-cognito-new"


def test_run_is_durable_and_idempotent(client: TestClient) -> None:
    payload = {
        "input": {"client": "Northstar", "deadline": "2026-08-14"},
        "idempotency_key": "test-run-key-001",
    }
    first = client.post("/v1/workflows/wf-client-brief/runs", json=payload)
    assert first.status_code == 201
    assert first.json()["status"] == "completed"
    assert len(first.json()["steps"]) == 5
    second = client.post("/v1/workflows/wf-client-brief/runs", json=payload)
    assert second.status_code == 201
    assert second.json()["id"] == first.json()["id"]
    audit = client.get(f"/v1/runs/{first.json()['id']}/audit")
    assert audit.status_code == 200
    assert [event["action"] for event in audit.json()] == ["run.started", "run.completed"]
