"""Team and workspace routes, with emphasis on the two refusals.

The seeded demo tenant has exactly one user (``user-alex``, a ``workflow_admin``),
which is precisely the state where both guards must fire.
"""

from fastapi.testclient import TestClient


def test_team_list_is_tenant_scoped(client: TestClient) -> None:
    mine = client.get("/v1/team")
    assert mine.status_code == 200
    assert any(member["id"] == "user-alex" for member in mine.json())
    other = client.get("/v1/team", headers={"X-WorkPilot-Tenant-ID": "tenant-other"})
    assert other.json() == []


def test_invite_update_and_remove(client: TestClient) -> None:
    created = client.post(
        "/v1/team",
        json={"email": "casey@northstar.example", "name": "Casey Lane", "role": "viewer"},
    )
    assert created.status_code == 201
    member = created.json()
    assert member["status"] == "invited"
    assert member["role"] == "viewer"

    # Inviting the same address twice is a conflict, not a duplicate row.
    again = client.post(
        "/v1/team",
        json={"email": "CASEY@northstar.example", "name": "Casey Lane", "role": "viewer"},
    )
    assert again.status_code == 409

    patched = client.patch(f"/v1/team/{member['id']}", json={"role": "approver", "status": "active"})
    assert patched.status_code == 200
    assert patched.json()["role"] == "approver"
    assert patched.json()["status"] == "active"

    assert client.patch(f"/v1/team/{member['id']}", json={"role": "sysadmin"}).status_code == 422
    assert client.delete(f"/v1/team/{member['id']}").status_code == 204
    assert all(row["id"] != member["id"] for row in client.get("/v1/team").json())
    assert client.delete(f"/v1/team/{member['id']}").status_code == 404


def test_cannot_remove_yourself(client: TestClient) -> None:
    # The default local principal *is* user-alex.
    refused = client.delete("/v1/team/user-alex")
    assert refused.status_code == 409
    assert "yourself" in refused.json()["detail"].lower()
    assert client.get("/v1/team").json()  # still there


def test_cannot_remove_the_last_workflow_admin(client: TestClient) -> None:
    # Other tests provision principals through ``ensure_principal_user``, which
    # mints workflow_admins, so drive the workspace down to a single admin first
    # rather than assuming the seeded state survived.
    others = [
        member["id"]
        for member in client.get("/v1/team").json()
        if member["role"] == "workflow_admin" and member["id"] != "user-alex"
    ]
    for member_id in others:
        assert client.patch(f"/v1/team/{member_id}", json={"role": "viewer"}).status_code == 200

    # Act as a different principal so the self-removal guard cannot mask this one.
    refused = client.delete("/v1/team/user-alex", headers={"X-WorkPilot-User-ID": "user-probe"})
    assert refused.status_code == 409
    assert "last workflow_admin" in refused.json()["detail"]

    # Demoting or suspending the last admin ends the same invariant, so both are refused too.
    assert client.patch("/v1/team/user-alex", json={"role": "viewer"}).status_code == 409
    assert client.patch("/v1/team/user-alex", json={"status": "suspended"}).status_code == 409

    alex = next(m for m in client.get("/v1/team").json() if m["id"] == "user-alex")
    assert alex["role"] == "workflow_admin"
    assert alex["status"] == "active"

    for member_id in others:
        client.patch(f"/v1/team/{member_id}", json={"role": "workflow_admin"})


def test_workspace_detail_and_rename(client: TestClient) -> None:
    workspace = client.get("/v1/workspace").json()
    assert workspace["slug"] == "northstar-projects"
    assert workspace["member_count"] >= 1
    assert workspace["workflow_count"] >= 1

    renamed = client.patch("/v1/workspace", json={"name": "Northstar Projects EU"})
    assert renamed.status_code == 200
    assert renamed.json()["name"] == "Northstar Projects EU"
    assert renamed.json()["slug"] == workspace["slug"]  # slug is immutable
    client.patch("/v1/workspace", json={"name": workspace["name"]})


def test_workspace_settings_round_trip(client: TestClient) -> None:
    defaults = client.get("/v1/workspace/settings").json()
    assert defaults["require_approval_for_writes"] is True
    assert defaults["retain_run_days"] == 90
    assert defaults["allow_tool_writes"] is False

    saved = client.put(
        "/v1/workspace/settings",
        json={
            "require_approval_for_writes": False,
            "max_run_cost_usd": 2.5,
            "notify_email": "ops@northstar.example",
            "retain_run_days": 30,
            # Sent but ignored: this is a server env-var decision.
            "allow_tool_writes": True,
        },
    )
    assert saved.status_code == 200
    assert saved.json()["max_run_cost_usd"] == 2.5
    assert saved.json()["notify_email"] == "ops@northstar.example"
    assert saved.json()["allow_tool_writes"] is False

    # Persisted, and an unset key keeps its stored value rather than resetting.
    reread = client.put("/v1/workspace/settings", json={"retain_run_days": 45}).json()
    assert reread["retain_run_days"] == 45
    assert reread["max_run_cost_usd"] == 2.5
    assert client.get("/v1/workspace/settings").json()["notify_email"] == "ops@northstar.example"
