# WorkPilot

WorkPilot is a no-code operations studio for non-technical business teams. A user can describe a process, review it as a visual workflow, test it without changing connected tools, keep sensitive decisions behind human approval, and inspect the resulting run history.

This repository contains the completed Phase 1 foundation from the product brief:

- responsive product UI with Home, Workflows, Templates, Runs, Approvals, Connections, Team, Analytics, and Settings;
- a workflow creation path and React Flow canvas with step configuration;
- safe test-run simulation and plain-language workflow explanations;
- tenant-scoped FastAPI workflow CRUD and OpenAPI documentation;
- PostgreSQL models and Alembic migration for tenants, users, workflows, versions, runs, steps, and audit events;
- a native deterministic executor for AI-assisted, condition, wait, tool, and end steps;
- Redis-backed worker mode plus synchronous local test mode;
- D1-backed hosted demo endpoints for durable workflow and run data;
- seeded Northstar Projects demo workspace and automated tests.

## Fastest way to see it

If you only want the interactive product UI, install Node.js 22.13 or newer, then run from the repository root:

```powershell
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). The UI uses realistic demo data, and the “Test safely” interaction runs without external credentials.

## Run the complete local stack

Docker Desktop is the recommended path because it includes the required PostgreSQL and Redis services automatically.

```powershell
docker compose up --build
```

Then open:

- product: [http://localhost:3000](http://localhost:3000)
- API health: [http://localhost:8000/health](http://localhost:8000/health)
- interactive API documentation: [http://localhost:8000/docs](http://localhost:8000/docs)

Stop the stack with `docker compose down`. Your local database is kept in a Docker volume so the demo records survive restarts.

## Required values

Phase 1 does not require API keys, OAuth credentials, AWS credentials, or a paid model provider. The deterministic mock provider is the local default and all tool actions remain in dry-run mode.

Docker Compose supplies its own local-only database values. If you run services without Docker, copy `.env.example` to `.env` and use:

- `WORKPILOT_DATABASE_URL`: a PostgreSQL connection string. In Docker it is already configured. Outside Docker, create a database/user in PostgreSQL and use the values shown by your database tool.
- `WORKPILOT_REDIS_URL`: normally `redis://localhost:6379/0` for a local Redis installation.
- `WORKPILOT_JWT_SECRET`: only needed for a shared environment. Generate one with `python -c "import secrets; print(secrets.token_urlsafe(48))"`; never commit the result.
- `NEXT_PUBLIC_CONTROL_PLANE_URL`: `http://localhost:8000` when the browser should use the FastAPI service.

Future Gmail, Drive, Slack, AWS, and model-provider phases will require provider-specific values, but they are intentionally not part of Phase 1.

## Run without Docker

Use two terminals.

Terminal 1 — API (SQLite fallback for a lightweight local check):

```powershell
cd apps/api
python -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install -e ".[dev]"
python -m app.seed
uvicorn app.main:app --reload --port 8000
```

Terminal 2 — web:

```powershell
npm install
$env:NEXT_PUBLIC_CONTROL_PLANE_URL="http://localhost:8000"
npm run dev
```

The production-shaped local path still uses Docker/PostgreSQL/Redis; SQLite exists only to make tests and first-run inspection easy.

## Checks

```powershell
npm run typecheck
npm run lint
npm run build
npm run test

cd apps/api
.\.venv\Scripts\python.exe -m ruff check .
.\.venv\Scripts\python.exe -m mypy app
.\.venv\Scripts\python.exe -m pytest
```

Equivalent Make targets are available: `make setup`, `make dev`, `make test`, `make lint`, `make typecheck`, `make migrate`, `make seed`, and `make e2e`.

## Safety notes

- Local authentication accepts the seeded demo identity and tenant headers. Set `WORKPILOT_LOCAL_AUTH_ENABLED=false` outside local development.
- Every workflow and run query is scoped to the authenticated tenant.
- The Phase 1 executor rejects live external writes.
- Idempotency keys prevent the same run request from being executed twice.
- Audit records are hash-chained within each tenant.
- Do not commit `.env`, credentials, database files, or tokens.

See [docs/implementation-status.md](docs/implementation-status.md) for delivered scope and later phases.
