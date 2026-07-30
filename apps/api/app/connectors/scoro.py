"""Scoro REST API v2 connector (read-only).

Why REST and not MCP: Scoro publishes an MCP endpoint at ``{site}/mcp``, but it
sits behind an APISIX gateway that requires a JWT bearer token. Presenting a
Scoro API key there returns::

    401  www-authenticate: Bearer realm="apisix",
         error="invalid_token", error_description="invalid jwt: invalid jwt string"

The same key authenticates immediately against the REST API v2, so that is the
transport WorkPilot uses.

Scoro's conventions:

* Every call is a **POST**, even a read. There are no GET list endpoints.
* Credentials go in the JSON **body** as ``apiKey`` — not a header.
* ``company_account_id`` is the site's subdomain and is required.
* Responses are ``{"status": "OK", "statusCode": 200, "data": [...]}``; a failure
  still returns HTTP 200 with ``status != "OK"``, so the HTTP code alone is not
  a success signal.
* Listing is ``POST {module}/list``, single-record is ``POST {module}/view/{id}``.
"""

from __future__ import annotations

import re
from typing import Any
from urllib.parse import urlparse

import httpx

from app.connectors.base import RestAuthError, RestConnector, RestTool, RestToolError

# Shared argument shapes.
_PAGING = {
    "page": {"type": "integer", "minimum": 1, "default": 1, "description": "1-based page number."},
    "per_page": {
        "type": "integer", "minimum": 1, "maximum": 100, "default": 25,
        "description": "Records per page (max 100).",
    },
}


def _list_schema(extra: dict[str, Any] | None = None) -> dict[str, Any]:
    props: dict[str, Any] = {**_PAGING, **(extra or {})}
    return {"type": "object", "properties": props, "required": [], "additionalProperties": False}


def _view_schema(id_name: str, id_desc: str) -> dict[str, Any]:
    return {
        "type": "object",
        "properties": {id_name: {"type": "integer", "description": id_desc}},
        "required": [id_name],
        "additionalProperties": False,
    }


# Tool name -> (module, kind, id field). `kind` is "list" or "view".
_ROUTES: dict[str, tuple[str, str, str | None]] = {
    "list_projects": ("projects", "list", None),
    "get_project": ("projects", "view", "project_id"),
    "list_tasks": ("tasks", "list", None),
    "get_task": ("tasks", "view", "task_id"),
    "list_users": ("users", "list", None),
    "list_companies": ("contacts", "list", None),
    "list_time_entries": ("timeEntries", "list", None),
    "list_invoices": ("invoices", "list", None),
    "list_quotes": ("quotes", "list", None),
    "list_orders": ("orders", "list", None),
    "list_project_phases": ("projectPhases", "list", None),
}

_TOOLS: list[RestTool] = [
    RestTool(
        "list_projects",
        "List Scoro projects with their status, manager and dates. Use this to answer "
        "questions about what projects exist or which ones need attention.",
        _list_schema({
            "status": {
                "type": "string",
                "enum": ["pending", "inprogress", "completed", "cancelled"],
                "description": "Optional status filter.",
            },
        }),
    ),
    RestTool("get_project", "Fetch one Scoro project in full detail by its id.",
             _view_schema("project_id", "Scoro project id, e.g. 120.")),
    RestTool(
        "list_tasks",
        "List Scoro tasks, including who they are assigned to and whether they are done. "
        "Optionally scope to a single project.",
        _list_schema({
            "project_id": {"type": "integer", "description": "Optional: only tasks on this project."},
            "status": {"type": "string", "enum": ["pending", "inprogress", "completed"],
                       "description": "Optional status filter."},
        }),
    ),
    RestTool("get_task", "Fetch one Scoro task in full detail by its id.",
             _view_schema("task_id", "Scoro task id.")),
    RestTool("list_users", "List Scoro users (team members) with names, emails and active status.",
             _list_schema()),
    RestTool("list_companies", "List Scoro contacts and companies (the CRM).", _list_schema()),
    RestTool("list_time_entries", "List logged time entries — who spent time on what, and when.",
             _list_schema({"project_id": {"type": "integer", "description": "Optional project filter."}})),
    RestTool("list_invoices", "List Scoro invoices with totals and payment status.", _list_schema()),
    RestTool("list_quotes", "List Scoro quotes with their totals and status.", _list_schema()),
    RestTool("list_orders", "List Scoro orders.", _list_schema()),
    RestTool("list_project_phases", "List project phases / milestones.",
             _list_schema({"project_id": {"type": "integer", "description": "Optional project filter."}})),
]

# Fields worth keeping. Scoro returns very wide records; trimming keeps the
# agent's prompt affordable and its attention on what matters.
_KEEP: dict[str, tuple[str, ...]] = {
    "projects": ("project_id", "no", "project_name", "status", "manager_email", "company_name",
                 "date", "deadline", "is_private", "description"),
    "tasks": ("event_id", "task_id", "subject", "status", "owner_email", "project_id",
              "datetime_due", "datetime_completed", "priority_id"),
    "users": ("id", "full_name", "email", "is_active", "status"),
    "contacts": ("contact_id", "name", "email", "phone", "contact_type", "is_client"),
    "timeEntries": ("time_entry_id", "title", "duration", "start_datetime", "project_id",
                    "person_id", "is_completed"),
    "invoices": ("invoice_id", "no", "company_name", "date", "deadline", "sum", "status",
                 "is_sent", "paid_sum"),
    "quotes": ("quote_id", "no", "company_name", "date", "sum", "status"),
    "orders": ("order_id", "no", "company_name", "date", "sum", "status"),
    "projectPhases": ("phase_id", "project_id", "title", "start_date", "end_date", "status"),
}


class ScoroConnector(RestConnector):
    connector_id = "scoro"
    label = "Scoro"

    # -- catalog -----------------------------------------------------------

    @classmethod
    def tools(cls) -> list[RestTool]:
        return list(_TOOLS)

    # -- helpers -----------------------------------------------------------

    @property
    def api_base(self) -> str:
        """Normalise whatever the user pasted into an ``/api/v2`` base.

        Accepts ``https://acme.scoro.com``, ``…/api/v2``, or even ``…/mcp``
        (which is the endpoint that cannot be used — see the module docstring).
        """
        base = self.base_url
        base = re.sub(r"/mcp/?$", "", base, flags=re.I)
        if re.search(r"/api/v\d+$", base, flags=re.I):
            return base
        return f"{base}/api/v2"

    @property
    def company_account_id(self) -> str:
        """Scoro's account id is the site subdomain: acme.scoro.com -> "acme"."""
        host = urlparse(self.api_base).hostname or ""
        return host.split(".")[0] if host else ""

    def _envelope(self, extra: dict[str, Any] | None = None) -> dict[str, Any]:
        body: dict[str, Any] = {
            "apiKey": self.token or "",
            "lang": "eng",
            "company_account_id": self.company_account_id,
        }
        body.update(extra or {})
        return body

    async def _post(self, path: str, body: dict[str, Any]) -> Any:
        url = f"{self.api_base}/{path.lstrip('/')}"
        try:
            async with httpx.AsyncClient(timeout=self.timeout, follow_redirects=True) as client:
                resp = await client.post(url, json=body)
        except httpx.TimeoutException as exc:
            raise RestToolError(f"Scoro timed out after {self.timeout:.0f}s ({path})") from exc
        except httpx.HTTPError as exc:
            raise RestToolError(f"Could not reach Scoro at {url}: {exc}") from exc

        if resp.status_code in (401, 403):
            raise RestAuthError(
                "Scoro rejected the API key. Check it under Settings > Work and projects > "
                "API, and make sure the site address matches this account."
            )
        if resp.status_code >= 400:
            raise RestToolError(f"Scoro returned HTTP {resp.status_code} for {path}")

        try:
            payload = resp.json()
        except ValueError as exc:
            snippet = (resp.text or "")[:200].replace("\n", " ")
            raise RestToolError(f"Scoro returned non-JSON for {path}: {snippet}") from exc

        # Scoro reports failures with HTTP 200 and status != OK.
        if isinstance(payload, dict) and payload.get("status") not in (None, "OK"):
            messages = payload.get("messages")
            detail = messages if messages else payload.get("status")
            if str(payload.get("statusCode")) in ("401", "403"):
                raise RestAuthError(f"Scoro rejected the API key: {detail}")
            raise RestToolError(f"Scoro error on {path}: {detail}")

        return payload.get("data") if isinstance(payload, dict) else payload

    @staticmethod
    def _trim(module: str, records: Any) -> Any:
        keep = _KEEP.get(module)
        if not keep or not isinstance(records, list):
            return records
        trimmed = []
        for rec in records:
            if not isinstance(rec, dict):
                trimmed.append(rec)
                continue
            slim = {k: rec[k] for k in keep if k in rec}
            trimmed.append(slim or rec)
        return trimmed

    # -- execution ---------------------------------------------------------

    async def verify(self) -> dict[str, Any]:
        if not self.token:
            raise RestAuthError("Scoro needs an API key. Paste it in the token field.")
        if not self.company_account_id:
            raise RestToolError(
                f"Could not work out the Scoro account from {self.base_url!r}. "
                "Use your full site address, e.g. https://yourcompany.scoro.com"
            )
        users = await self._post("users/list", self._envelope({"per_page": 1}))
        count = len(users) if isinstance(users, list) else 0
        return {
            "name": "Scoro",
            "account": self.company_account_id,
            "api_base": self.api_base,
            "verified_with": "users/list",
            "users_visible": count,
        }

    async def call(self, tool_name: str, arguments: dict[str, Any]) -> Any:
        route = _ROUTES.get(tool_name)
        if route is None:
            available = ", ".join(sorted(_ROUTES))
            raise RestToolError(f"Unknown Scoro tool {tool_name!r}. Available: {available}")

        module, kind, id_field = route
        args = {k: v for k, v in (arguments or {}).items() if v is not None}

        if kind == "view":
            record_id = args.get(id_field or "")
            if record_id in (None, ""):
                raise RestToolError(f"{tool_name} needs {id_field}.")
            data = await self._post(f"{module}/view/{record_id}", self._envelope())
            return {"record": data}

        body: dict[str, Any] = {
            "page": int(args.pop("page", 1) or 1),
            "per_page": min(int(args.pop("per_page", 25) or 25), 100),
        }
        # Anything left over is a filter (status, project_id, …).
        if args:
            body["filter"] = args

        data = await self._post(f"{module}/list", self._envelope(body))
        records = self._trim(module, data)
        return {
            "count": len(records) if isinstance(records, list) else 0,
            "page": body["page"],
            module: records,
        }
