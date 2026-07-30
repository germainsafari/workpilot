"""Tests for the plain-English workflow compiler and the derived explanation.

The interesting cases are all about *not* trusting the model: output that does
not validate must never reach the caller as if it worked, and a binding to a tool
the tenant does not have must be stripped rather than shipped as a step that
would fail the moment it ran.
"""

import json
from typing import Any

import pytest
from fastapi.testclient import TestClient

from app import authoring
from app.authoring import compile_description, fallback_definition, sanitize_bindings
from app.schemas import CanonicalWorkflow, ToolStep

SCORO_CONNECTION = "conn-scoro-test"

CATALOG: list[dict[str, Any]] = [
    {
        "connection_id": SCORO_CONNECTION,
        "connection_name": "Scoro (Admind)",
        "connector_id": "scoro",
        "tool_name": "list_projects",
        "description": "List Scoro projects with their status, manager and dates.",
        "read_only": True,
        "input_schema": {"type": "object", "properties": {"per_page": {"type": "integer"}}},
    }
]


def _reply(workflow: dict[str, Any], rationale: str = "Because.") -> str:
    return json.dumps({"workflow": workflow, "rationale": rationale})


def _good_workflow(connection_id: str = SCORO_CONNECTION, tool: str = "list_projects") -> dict:
    return {
        "apiVersion": "workpilot.io/v1",
        "kind": "Workflow",
        "trigger": {"type": "manual", "label": "Run Scoro project review"},
        "steps": [
            {
                "id": "fetchProjects",
                "name": "Fetch Scoro projects",
                "type": "tool",
                "operation": "fetch_records",
                "connection_id": connection_id,
                "tool_name": tool,
                "arguments": {"per_page": 50},
                "mode": "read",
            },
            {
                "id": "summarize",
                "name": "Summarise status and flag review",
                "type": "ai_task",
                "task": "summarize",
            },
            {"id": "finish", "name": "Review ready", "type": "end", "outcome": "needs_review"},
        ],
        "edges": [
            {"from": "fetchProjects", "to": "summarize"},
            {"from": "summarize", "to": "finish"},
        ],
    }


def _patch_model(monkeypatch: pytest.MonkeyPatch, replies: list[str]) -> list[str]:
    """Stub the Bedrock call with canned replies; returns the prompts it saw."""
    seen: list[str] = []
    queue = list(replies)

    async def fake_ask(messages: list[dict[str, str]]) -> str:
        seen.append(messages[-1]["content"])
        return queue.pop(0)

    monkeypatch.setattr(authoring, "_ask_model", fake_ask)
    return seen


# ── binding validation ────────────────────────────────────────────────────


def test_hallucinated_tool_binding_is_dropped() -> None:
    """A tool the tenant does not have must not survive into the definition."""
    raw = _good_workflow(tool="list_unicorns")
    dropped = sanitize_bindings(raw, CATALOG)

    assert len(dropped) == 1
    assert dropped[0].step_id == "fetchProjects"
    assert dropped[0].tool_name == "list_unicorns"
    assert "callable tool" in dropped[0].reason

    step = raw["steps"][0]
    assert step["connection_id"] is None
    assert step["tool_name"] is None
    assert step["arguments"] == {}
    # The graph is still valid — an unbound tool step is legal, a fake one is not.
    definition = CanonicalWorkflow.model_validate(raw)
    assert isinstance(definition.steps[0], ToolStep)
    assert definition.steps[0].is_bound is False


def test_hallucinated_connection_is_dropped() -> None:
    dropped = sanitize_bindings(_good_workflow(connection_id="conn-invented"), CATALOG)
    assert len(dropped) == 1
    assert "conn-invented" in dropped[0].reason


def test_real_binding_survives() -> None:
    raw = _good_workflow()
    assert sanitize_bindings(raw, CATALOG) == []
    assert raw["steps"][0]["tool_name"] == "list_projects"


# ── compiling ─────────────────────────────────────────────────────────────


async def test_compile_binds_a_real_tool(monkeypatch: pytest.MonkeyPatch) -> None:
    _patch_model(monkeypatch, [_reply(_good_workflow(), "Fetches then summarises.")])
    result = await compile_description("Fetch my Scoro projects and flag review.", CATALOG)

    assert result.ai_compiled is True
    assert result.compile_error is None
    assert result.dropped_bindings == []
    assert [(b.step_id, b.tool_name, b.connection_name) for b in result.bound_tools] == [
        ("fetchProjects", "list_projects", "Scoro (Admind)")
    ]
    assert result.rationale == "Fetches then summarises."
    assert result.catalog_size == 1


async def test_compile_drops_hallucinated_binding_but_keeps_the_graph(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _patch_model(monkeypatch, [_reply(_good_workflow(tool="list_unicorns"))])
    result = await compile_description("Fetch my Scoro projects.", CATALOG)

    assert result.ai_compiled is True
    assert result.bound_tools == []
    assert len(result.dropped_bindings) == 1
    assert result.dropped_bindings[0].tool_name == "list_unicorns"


async def test_invalid_output_is_retried_then_accepted(monkeypatch: pytest.MonkeyPatch) -> None:
    """A graph that fails validation earns exactly one retry, with the error attached."""
    broken = _good_workflow()
    broken["edges"].append({"from": "summarize", "to": "nowhere"})
    prompts = _patch_model(monkeypatch, [_reply(broken), _reply(_good_workflow())])

    result = await compile_description("Fetch my Scoro projects.", CATALOG)

    assert len(prompts) == 2
    assert "unknown step" in prompts[1]  # the validation error was fed back
    assert result.ai_compiled is True
    assert result.compile_error is None


async def test_persistently_invalid_output_falls_back_and_says_so(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Never return an invalid graph, and never pretend the compile worked."""
    broken = _good_workflow()
    broken["steps"] = [s for s in broken["steps"] if s["type"] != "end"]  # no end step
    broken["edges"] = [{"from": "fetchProjects", "to": "summarize"}]
    _patch_model(monkeypatch, [_reply(broken), _reply(broken)])

    result = await compile_description("Fetch my Scoro projects.", CATALOG)

    assert result.ai_compiled is False
    assert result.compile_error is not None
    assert "must contain an end step" in result.compile_error
    assert result.bound_tools == []
    # Still a valid, callable-nothing graph.
    assert result.definition.model_dump() == fallback_definition("x").model_dump()


async def test_non_json_output_falls_back(monkeypatch: pytest.MonkeyPatch) -> None:
    _patch_model(monkeypatch, ["I'm sorry, I can't help with that.", "Still no."])
    result = await compile_description("Do a thing.", CATALOG)
    assert result.ai_compiled is False
    assert "no JSON object" in (result.compile_error or "")


async def test_nova_thinking_tags_are_stripped(monkeypatch: pytest.MonkeyPatch) -> None:
    """Nova narrates before answering; the narration is not the answer."""
    wrapped = (
        "<thinking>The user wants Scoro projects.</thinking>"
        f"<response>{_reply(_good_workflow())}</response>"
    )
    _patch_model(monkeypatch, [wrapped])
    result = await compile_description("Fetch my Scoro projects.", CATALOG)
    assert result.ai_compiled is True
    assert result.bound_tools[0].tool_name == "list_projects"


async def test_write_tools_are_hidden_from_the_compiler(monkeypatch: pytest.MonkeyPatch) -> None:
    """With writes disabled a write tool is not in the catalog, so binding to it is invented."""
    from app.config import get_settings

    assert get_settings().allow_tool_writes is False
    _patch_model(monkeypatch, [_reply(_good_workflow(tool="create_project"))])
    result = await compile_description("Create a Scoro project.", CATALOG)
    assert result.bound_tools == []
    assert result.dropped_bindings[0].tool_name == "create_project"


# ── the HTTP surface ──────────────────────────────────────────────────────


def test_compile_endpoint_returns_a_valid_graph(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    _patch_model(monkeypatch, [_reply(_good_workflow())])
    response = client.post(
        "/v1/workflows/compile",
        json={"description": "Fetch my Scoro projects, summarize status, and flag review."},
    )
    assert response.status_code == 200
    body = response.json()
    # Serialized with the wire aliases the frontend and the create endpoint expect.
    assert body["definition"]["apiVersion"] == "workpilot.io/v1"
    assert body["definition"]["edges"][0]["from"] == "fetchProjects"
    # The test tenant has no connected Scoro, so the binding is correctly dropped.
    assert body["ai_compiled"] is True
    assert body["bound_tools"] == []
    assert body["dropped_bindings"][0]["tool_name"] == "list_projects"

    # The compiled definition round-trips into a real workflow.
    created = client.post(
        "/v1/workflows",
        json={
            "name": "Compiled Scoro review",
            "description": "Fetch my Scoro projects.",
            "definition": body["definition"],
        },
    )
    assert created.status_code == 201


def test_compile_endpoint_rejects_an_empty_description(client: TestClient) -> None:
    assert client.post("/v1/workflows/compile", json={"description": ""}).status_code == 422


def test_explanation_detail_is_derived_and_never_invents_a_cost(client: TestClient) -> None:
    created = client.post(
        "/v1/workflows",
        json={
            "name": "Explained workflow",
            "description": "Summarise the week.",
            "definition": {
                "apiVersion": "workpilot.io/v1",
                "trigger": {"type": "schedule", "label": "Every Monday morning"},
                "steps": [
                    {"id": "summarize", "name": "Summarise", "type": "ai_task", "task": "summarize"},
                    {
                        "id": "finish",
                        "name": "Ready for review",
                        "type": "end",
                        "outcome": "needs_review",
                    },
                ],
                "edges": [{"from": "summarize", "to": "finish"}],
            },
        },
    ).json()

    detail = client.get(f"/v1/workflows/{created['id']}").json()
    explanation = detail["explanation_detail"]

    # The legacy string field still exists for older clients.
    assert isinstance(detail["explanation"], str) and detail["explanation"]

    assert "Every Monday morning" in explanation["trigger"]
    assert "on a schedule" in explanation["trigger"]
    assert [s["step_id"] for s in explanation["steps"]] == ["summarize", "finish"]
    assert "short summary" in explanation["steps"][0]["detail"]
    assert explanation["steps"][0]["binding"] is None
    assert "Ready for review" in explanation["approval"]
    assert "retried once" in explanation["on_failure"]

    # Never a made-up figure.
    assert explanation["cost"]["sample_size"] == 0
    assert explanation["cost"]["headline"] == "No runs yet"
    assert explanation["cost"]["average_cost_usd"] is None

    client.delete(f"/v1/workflows/{created['id']}")


def test_explanation_cost_uses_real_run_history(client: TestClient) -> None:
    created = client.post(
        "/v1/workflows",
        json={
            "name": "Measured workflow",
            "description": "Wait then finish.",
            "definition": {
                "apiVersion": "workpilot.io/v1",
                "trigger": {"type": "manual", "label": "Manual start"},
                "steps": [
                    {"id": "wait", "name": "Wait", "type": "wait", "duration_seconds": 0},
                    {"id": "finish", "name": "Finish", "type": "end"},
                ],
                "edges": [{"from": "wait", "to": "finish"}],
            },
        },
    ).json()

    for _ in range(2):
        assert client.post(f"/v1/workflows/{created['id']}/runs", json={}).status_code in (
            201,
            202,
        )

    cost = client.get(f"/v1/workflows/{created['id']}").json()["explanation_detail"]["cost"]
    assert cost["sample_size"] == 2
    assert cost["average_cost_usd"] is not None
    assert "across 2 finished runs" in cost["caption"]

    client.delete(f"/v1/workflows/{created['id']}")
