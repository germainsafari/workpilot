# WorkPilot

WorkPilot is a **no-code agentic operations platform** — a studio where non-technical teams describe business processes as visual workflows, test them safely with real AI, and monitor every run with full cost and audit transparency.

**Positioning:** *WorkPilot is the studio where teams turn business processes into governed AI workflows — design visually, test safely, run with real models, and audit everything.*

**Live deployment:** set `NEXT_PUBLIC_CONTROL_PLANE_URL_STAGING` in your local `.env`  
**AI runtime:** Amazon Bedrock · Amazon Nova Micro (eu-central-1 cross-region inference)  
**Auth:** AWS Cognito user pool (eu-central-1)

---

## Table of contents

- [What WorkPilot solves](#what-workpilot-solves)
- [Architecture](#architecture)
- [Tech stack](#tech-stack)
- [Core concepts](#core-concepts)
- [Execution pipeline](#execution-pipeline)
- [AI runtimes](#ai-runtimes)
- [Product areas](#product-areas)
- [Authentication and multi-tenancy](#authentication-and-multi-tenancy)
- [Data model](#data-model)
- [What's real vs. simulated](#whats-real-vs-simulated)
- [Repository layout](#repository-layout)
- [How to run](#how-to-run)
- [What you can do right now](#what-you-can-do-right-now)
- [Suggested demo script](#suggested-demo-script)
- [MCP server integration](#mcp-server-integration)
- [Viewing logs](#viewing-logs)
- [Deploy for everyone (production)](#deploy-for-everyone-production)
- [Environment variables](#environment-variables)
- [AI models](#ai-models)
- [Architecture decisions](#architecture-decisions)
- [Checks](#checks)
- [Security notes](#security-notes)

---

## What WorkPilot solves

| Pain point | WorkPilot answer |
|---|---|
| Business users can't write code or prompts | Visual workflow builder + plain-language explanations |
| AI agents are opaque and risky | Every step is typed, validated, and logged; writes are gated |
| No visibility into AI cost | Per-run and per-step token/cost tracking |
| Hard to connect to existing tools | MCP (Model Context Protocol) servers + business connectors |
| Compliance / audit needs | Hash-chained, tenant-scoped audit trail |

**Target users:** non-technical operations, account, finance, or project teams (demo tenant: *Northstar Projects*).

---

## Architecture

WorkPilot uses a **two-layer design**:

1. **Product UI** — Next.js 16 app built with **vinext** (compiles to a **Cloudflare Worker**, not standard Vercel Next.js output).
2. **Control plane** — Python **FastAPI** API (`apps/api`) that owns workflows, runs, auth, execution, and audit.

The UI is **backend-agnostic**: it talks to FastAPI on AWS/local via `NEXT_PUBLIC_CONTROL_PLANE_URL`, or falls back to same-origin demo data / Cloudflare D1.

```
┌─────────────────────────────────────────────────────────────────┐
│  Frontend (Next.js / vinext)                                    │
│  React UI + React Flow canvas                                   │
│  /api/control-plane proxy  │  optional Cloudflare D1 /v1 routes │
└───────────────┬─────────────────────────────┬───────────────────┘
                │                             │
                ▼                             ▼
┌───────────────────────────┐     ┌───────────────────────────────┐
│  AWS (staging/production) │     │  Local (Docker Compose)       │
│  ALB → ECS Fargate (API)  │     │  PostgreSQL + Redis           │
│  Redis worker             │     │  FastAPI :8000 + Web :3000    │
│  Cognito · Bedrock        │     │                               │
│  CloudWatch + X-Ray       │     │                               │
└───────────────────────────┘     └───────────────────────────────┘
```

**Cross-origin proxy:** When the UI is HTTPS (Cloudflare) and the API is HTTP (ALB), browser calls go through `/api/control-plane` to avoid mixed-content and CORS issues.

---

## Tech stack

### Frontend

| Layer | Technology |
|---|---|
| Framework | Next.js 16 + React 19 |
| Build / deploy | **vinext** + Vite + Cloudflare Workers plugin |
| Visual editor | **@xyflow/react** (React Flow) — pan, zoom, drag, connect steps |
| Styling | Tailwind CSS 4 |
| Validation | Zod |
| Local DB option | Drizzle ORM + Cloudflare D1 (SQLite) |

### Backend (control plane)

| Layer | Technology |
|---|---|
| API | FastAPI + Pydantic v2 |
| ORM | SQLAlchemy async |
| Migrations | Alembic |
| Database | PostgreSQL (primary) |
| Queue | Redis (`workpilot:runs` list) |
| Logging | structlog |
| Observability | OpenTelemetry → AWS X-Ray / CloudWatch (optional) |

### AI and agents

| Runtime | When used |
|---|---|
| `deterministic_mock` | Local dev, tests — predictable outputs, $0 cost |
| `bedrock_langgraph` | Real AI via **LangGraph ReAct agent** + **Amazon Bedrock** (Nova Micro default) |
| `agentcore` | **Bedrock AgentCore** runtime (Docker default for AWS-style runs) |

### Infrastructure (AWS, eu-central-1)

- **Terraform** in `infra/`: VPC, ALB, ECS Fargate, ECR, Cognito, Secrets Manager, IAM
- **Auth:** AWS Cognito JWT (RS256) in staging/production
- **AI:** Amazon Nova Micro (`eu.amazon.nova-micro-v1:0`) — typically $0.0003–$0.001 per test run

See [`infra/README.md`](infra/README.md) for Terraform usage.

---

## Core concepts

Everything revolves around a versioned schema: **`workpilot.io/v1`**.

Stored in `workflow_versions.canonical_definition` as JSON, validated by Pydantic before every save and every run. Workflows are **not** stored as LangGraph/CrewAI code — they are declarative JSON. The **Native Executor** walks the graph deterministically; AI is only invoked inside typed `ai_task` steps.

### Step types

| Type | Purpose |
|---|---|
| `ai_task` | LLM does structured work: extract, summarize, classify, prepare |
| `tool` | Calls external system via MCP (read or write) |
| `condition` | Branch on truthiness (`ready`/`yes` vs `missing`/`no`) |
| `wait` | Pause (timed or event-based) |
| `end` | Terminal state |

### Example flow (Client brief processor)

```
Trigger → AI extract fields → Condition (deadline missing?)
   → yes: end with flag
   → no: AI prepare tasks → end
```

Step output is threaded through the run context. Argument templates like `{{fetchProjects.result}}` resolve against earlier step outputs.

---

## Execution pipeline

When a user clicks **Test safely**:

1. `POST /v1/workflows/{id}/runs` (with idempotency key)
2. Run row created in PostgreSQL
3. Either:
   - **Inline execution** (local dev: `WORKPILOT_EXECUTE_RUNS_INLINE=true`)
   - **OR** pushed to Redis queue → worker consumes
4. `execute_persisted_run()`:
   - Re-validates canonical definition
   - Builds `NativeExecutor` with chosen `AgentRuntime`
   - Walks graph step-by-step
   - Persists `StepRun` per step (input, output, model_usage, tool_usage)
   - Updates run status, total_cost, token_usage
   - Writes audit event (`run.completed` / `run.failed`)
5. UI polls run status → RunDetailsDrawer shows step timeline + cost

### Safety invariants

- **Tenant scoping** on every database query
- **Idempotency keys** prevent duplicate runs
- **Cycle detection** — workflows can't loop forever
- **Tool writes refused** unless explicitly allowed (`WORKPILOT_ALLOW_TOOL_WRITES`)
- **Safe mode / dry-run** default for external writes
- **Hash-chained audit** — each event links to the previous hash (tamper-evident per tenant)

---

## AI runtimes

### Deterministic mock

Returns predictable JSON for extract/summarize/classify/prepare. Zero cost. Used in tests and offline demo.

### Bedrock + LangGraph (real AI)

- ReAct agent backed by Bedrock Converse API
- Task-specific system prompts (extract → JSON only, no prose)
- **Real MCP tools** injected so AI can fetch live data (e.g. Scoro projects)
- Token usage and **USD cost** calculated and stored per step
- Failures are visible (no silent fallback to mock except missing credentials)

### Cost transparency

A typical "Test safely" run on Nova Micro costs **$0.0003–$0.001** — shown in the run drawer and Analytics.

---

## Product areas

| Section | Route | What it does |
|---|---|---|
| Home | `/` | Dashboard: metrics, exceptions, recent runs |
| Workflows | `/workflows` | List, create, open visual editor |
| Templates | `/templates` | Pre-built workflow templates |
| Runs | `/runs` | All executions: status, duration, cost |
| Approvals | `/approvals` | Human-in-the-loop review queue |
| Connections | `/connections` | MCP servers + business connectors |
| Team | `/team` | Members, roles |
| Analytics | `/analytics` | Completion rate, duration, AI spend |
| Settings | `/settings` | Workspace configuration |

The **Workflow Editor** (`app/workflows/[id]/WorkflowEditor.tsx`) is the centerpiece:

- React Flow canvas with minimap, keyboard delete, step settings panel
- Tabs: Canvas, Plain-language explanation, Permissions, Usage estimate, Run history
- Live "Test safely" with polling until terminal state

---

## Authentication and multi-tenancy

### Production (AWS Cognito)

- Login at `/login`
- JWT stored in `localStorage` as `wp-jwt`
- Sent as `Authorization: Bearer <token>` on every API call
- Custom claim: `custom:tenant_id` (e.g. `tenant-northstar`)

### Local dev

- `WORKPILOT_LOCAL_AUTH_ENABLED=true`
- Header stub: `X-WorkPilot-Tenant-ID: tenant-northstar` — no token needed

### Multi-tenant model

```
Tenant → Users → Workflows → Versions → Runs → StepRuns
                              ↓
                         AuditEvents (hash-chained)
                         Connections (encrypted credentials)
```

---

## Data model

```
tenants
  └── users
  └── workflows
        └── workflow_versions  (immutable canonical_definition JSON)
              └── workflow_runs  (idempotency_key unique per tenant)
                    └── step_runs  (per-step I/O, model_usage, tool_usage)
  └── audit_events  (immutable_hash chain)
  └── connections  (encrypted third-party credentials)
```

The same concepts are mirrored in **Cloudflare D1** (`db/schema.ts`) for the hosted demo adapter. See [ADR 0001](docs/adr/0001-dual-data-adapters.md).

---

## What's real vs. simulated

| Capability | Status |
|---|---|
| Visual workflow builder | Real |
| Workflow CRUD + versioning | Real |
| Run execution + history | Real |
| Real Bedrock AI runs | Real (when configured) |
| Cost tracking per run | Real |
| Audit trail | Real (hash-chained) |
| MCP tool calls (reads) | Real |
| MCP / tool writes | Blocked by default (safety) |
| Approval pause/resume | UI present; durable backend pause is roadmap |
| OAuth connectors (Gmail, Slack, etc.) | UI + demo; full OAuth is roadmap |
| NL → workflow generation | Deferred |

See [`docs/production-readiness.md`](docs/production-readiness.md) for the roadmap to full production.

---

## Repository layout

```
workpilot/
├── app/                    # Next.js UI pages and components
├── lib/                    # API client, types, workflow mapping
├── db/                     # D1 schema + runtime adapter
├── worker/                 # Cloudflare Worker entry
├── apps/api/               # FastAPI control plane
│   ├── app/executor.py     # Native workflow executor
│   ├── app/runtimes/       # Bedrock, LangGraph, deterministic
│   ├── app/mcp/            # MCP client
│   └── alembic/            # DB migrations
├── apps/mcp-server/        # Demo MCP server
├── infra/                  # Terraform (AWS)
├── docs/adr/               # Architecture decision records
└── docker-compose.yml      # Local full stack
```

---

## How to run

### Option A — Docker (recommended, full local stack)

The Docker stack runs everything locally: PostgreSQL, Redis, API, background worker, and the web UI — all wired together automatically.

```bash
docker compose up --build
```

Open:
- **UI:** http://localhost:3000
- **API docs:** http://localhost:8000/docs
- **API health:** http://localhost:8000/health

Stop with `docker compose down`. Your local database survives restarts (Docker volume). To also delete data: `docker compose down -v`.

The web container already has `NEXT_PUBLIC_CONTROL_PLANE_URL=http://localhost:8000` so it calls the local API, not AWS.

### Option B — Dev server (UI only, API on AWS)

Use this when you want live-reloading of frontend code while the API and AI run on the staging AWS cluster.

```bash
npm install
npm run dev         # starts on http://localhost:3001 (or 3000 if Docker web isn't running)
```

The `.env.local` file already points to the AWS ALB and Cognito. Log in with your Cognito credentials at http://localhost:3001/login.

> **Port note:** Docker web occupies port 3000. The dev server uses 3001 when launched from the IDE (`.claude/launch.json`). From the terminal, `npm run dev` defaults to 3000. If Docker is running, stop the web container first: `docker compose stop web`.

### Option C — UI only (no backend, demo data)

No API, no credentials, no Docker:

```bash
npm install
npm run dev
```

All pages show realistic demo data. The "Test safely" button simulates a run locally. Useful for UI development.

### Deployment modes summary

| Mode | Use case |
|---|---|
| **Docker Compose** | Full local stack: PG + Redis + API + Worker + Web |
| **Dev server + AWS API** | Frontend hot-reload, backend on staging ECS |
| **UI-only demo** | No backend — static demo data in browser |
| **Cloudflare Workers** | Frontend on Cloudflare, API on AWS ALB |
| **AWS ECS (staging)** | Production-shaped: ALB → Fargate, Cognito, Bedrock |

---

## What you can do right now

### Create and test a real AI workflow

1. Open the UI → **Workflows**
2. Click any workflow (e.g. "Client brief processor")
3. Click **Test safely** — this triggers a real Amazon Bedrock (Nova Micro) AI run
4. The drawer shows every step, duration, and exact AI cost (typically $0.0003–$0.001)

### See all runs

Open **Runs** — every execution is listed with status, step count, duration, and AI cost.

### View real-time metrics

Open **Analytics** — completion rate, average duration, and total AI cost are computed from live run data.

### Review pending approvals

Open **Approvals** — any run paused for human review appears as a live approval card alongside the demo items.

### Connect an MCP server

Open **Connections** → **MCP Servers** — add any Model Context Protocol server to give your AI agents new tools.

---

## Suggested demo script

A 5-minute walkthrough for presentations:

1. **Login** — Cognito or local stub
2. **Workflows** → open "Client brief processor"
3. Show **visual canvas** — explain step types in business language ("AI reads the brief", "checks if deadline exists")
4. Click **Test safely** — real Bedrock run
5. Open **Run drawer** — step timeline, duration, exact AI cost
6. **Runs** page — full history
7. **Analytics** — aggregate metrics
8. **Connections** → mention MCP (optional: show demo server)
9. Close with **governance**: tenant isolation, audit log, safe mode

---

## MCP server integration

MCP (Model Context Protocol) lets you connect any tool server to your AI agents. WorkPilot's AI executor can call MCP tools as workflow steps.

```
Connections page → store MCP server URL + credentials
                → API discovers tools via tools/list
                → Tool steps / AI tasks invoke tools via tools/call
```

**Read vs write policy:** the MCP client classifies tools as read-only vs write; the executor enforces policy.

Built-in **Scoro connector** exists in the API (`apps/api/app/connectors/scoro.py`) for business-system integration.

### Run the demo MCP server

```bash
pip install fastmcp
python apps/mcp-server/server.py
```

The server starts at http://localhost:9000 and exposes three demo tools: `get_weather`, `summarise_text`, `list_tasks`.

### Connect your own MCP server

Any MCP-compatible server works. Popular ready-made servers:

```bash
# Official MCP servers (Node.js)
npx @modelcontextprotocol/server-filesystem   # read/write local files
npx @modelcontextprotocol/server-brave-search # web search (needs Brave API key)
npx @modelcontextprotocol/server-github       # GitHub issues/PRs

# Python servers
pip install fastmcp   # build your own in ~20 lines
```

Add the server URL in WorkPilot → Connections → MCP Servers → Connect.

### Practical use cases with MCP

| Use case | MCP tools needed | What WorkPilot adds |
|---|---|---|
| Brief intake | `read_file`, `gmail_read` | AI extracts fields, routes for approval |
| Invoice processing | `read_file`, `accounting_get` | AI validates line items, flags anomalies |
| Meeting → actions | `calendar_read`, `slack_post` | AI writes action items, assigns owners |
| Asset review | `drive_read`, `notion_update` | AI checks against brand guidelines |
| Support triage | `zendesk_get`, `slack_post` | AI classifies severity, escalates |

---

## Viewing logs

### API logs (CloudWatch)

All ECS container logs go to CloudWatch Logs automatically.

1. Open [AWS CloudWatch Logs](https://eu-central-1.console.aws.amazon.com/cloudwatch/home?region=eu-central-1#logsV2:log-groups)
2. Click log group: **`/workpilot/staging/api`**
3. Click the latest log stream (named `ecs/workpilot-staging-api/<task-id>`)
4. You will see every HTTP request, AI run step, cost, and error

**Filter useful log patterns:**
- All AI runs: filter `bedrock_langgraph`
- Errors only: filter `ERROR`
- Cost data: filter `cost`
- Auth events: filter `tenant_id`

### Traces (AWS X-Ray)

Every API request is traced end-to-end. Open [AWS X-Ray](https://eu-central-1.console.aws.amazon.com/xray/home?region=eu-central-1#/traces) to see request waterfall, latency, and DB query traces.

### Local logs

When running with Docker or `uvicorn`, logs go to stdout. Watch them with:

```bash
docker compose logs -f api
```

---

## Deploy for everyone (production)

The staging API is already on AWS ECS Fargate behind an ALB. To make it accessible to your whole team, deploy the frontend too.

### Option 1 — AWS Amplify (easiest, ~5 minutes)

```bash
# Install Amplify CLI
npm install -g @aws-amplify/cli

# From the repo root
amplify init
amplify add hosting
# Choose: Amazon CloudFront and S3
amplify publish
```

Set these environment variables in Amplify console → App settings → Environment variables (values from your `.env`):

```
NEXT_PUBLIC_CONTROL_PLANE_URL = <from NEXT_PUBLIC_CONTROL_PLANE_URL_STAGING in .env>
NEXT_PUBLIC_COGNITO_CLIENT_ID = <from NEXT_PUBLIC_COGNITO_CLIENT_ID in .env>
NEXT_PUBLIC_COGNITO_REGION    = eu-central-1
```

### Option 2 — Add the frontend to ECS (same cluster)

Build and push the web image, then add a `workpilot-staging-web` ECS service behind the ALB on port 3000. The Terraform in `infra/` includes a placeholder for this.

### Option 3 — Cloudflare Workers (matches this toolchain)

This app is built with `vinext` + the Cloudflare Vite plugin, so it compiles to a
Cloudflare Worker (not a Vercel/Next.js output). Deploy it directly to Cloudflare:

```bash
npm install
npm run build                                   # emits dist/ + dist/server/wrangler.json
npx wrangler login                              # one-time, opens browser
npx wrangler deploy -c dist/server/wrangler.json
```

Set these **build-time** variables in Cloudflare (Pages/Workers → Settings → Environment variables)
or in your local `.env` before `npm run build`:

```
NEXT_PUBLIC_CONTROL_PLANE_URL   # AWS ALB URL (see NEXT_PUBLIC_CONTROL_PLANE_URL_STAGING in .env)
NEXT_PUBLIC_COGNITO_CLIENT_ID
NEXT_PUBLIC_COGNITO_REGION
```

**D1 database:** Cloudflare rejects deploys that reference a fake D1 id. You have two modes:

| Mode | `CLOUDFLARE_D1_DATABASE_ID` | `NEXT_PUBLIC_CONTROL_PLANE_URL` |
|------|----------------------------|----------------------------------|
| AWS backend (recommended) | leave empty | your AWS ALB URL |
| Self-contained demo on Cloudflare | real id from `wrangler d1 create workpilot` | empty or same-origin |

For AWS mode, leave `CLOUDFLARE_D1_DATABASE_ID` unset — the Worker deploys without a D1 binding
and the UI talks to your FastAPI control plane on ECS.

> **Vercel?** Not supported out of the box — Vercel expects a `next build` output,
> but this repo produces a Cloudflare Worker. Hosting on Vercel would require
> migrating the frontend off `vinext` to standard Next.js.

### Add a custom domain

1. Register a domain (e.g. app.yourcompany.com) in Route 53
2. Create an HTTPS listener on the ALB with an ACM certificate
3. Point a CNAME to the ALB DNS or Amplify URL

### Add team members (Cognito)

Create accounts in AWS Cognito → User pools → `workpilot-staging`:

```bash
aws cognito-idp admin-create-user \
  --user-pool-id $WORKPILOT_COGNITO_USER_POOL_ID \
  --username newuser@yourcompany.com \
  --user-attributes Name=custom:tenant_id,Value=tenant-northstar \
  --temporary-password $COGNITO_TEMP_PASSWORD \
  --region eu-central-1
```

Each user needs `custom:tenant_id=tenant-northstar` to see the Northstar Projects workspace.

---

## Environment variables

### API (ECS / docker-compose / .env)

| Variable | Default | Description |
|---|---|---|
| `WORKPILOT_DATABASE_URL` | — | PostgreSQL connection string |
| `WORKPILOT_REDIS_URL` | — | Redis connection string |
| `WORKPILOT_ENVIRONMENT` | `local` | `local` \| `staging` \| `production` |
| `WORKPILOT_LOCAL_AUTH_ENABLED` | `true` | Accept `X-WorkPilot-Tenant-ID` header without JWT |
| `WORKPILOT_COGNITO_USER_POOL_ID` | — | Required for Cognito JWT validation |
| `WORKPILOT_COGNITO_APP_CLIENT_ID` | — | Cognito app client ID |
| `WORKPILOT_COGNITO_REGION` | `eu-central-1` | Cognito region |
| `WORKPILOT_AGENT_RUNTIME` | `deterministic_mock` | `deterministic_mock` \| `bedrock_langgraph` \| `agentcore` |
| `WORKPILOT_BEDROCK_MODEL_ID` | `eu.amazon.nova-micro-v1:0` | Bedrock model (cross-region profile) |
| `WORKPILOT_BEDROCK_REGION` | `eu-central-1` | Bedrock region |
| `WORKPILOT_CORS_ORIGINS` | `http://localhost:3000` | Comma-separated allowed origins |
| `WORKPILOT_OTEL_ENABLED` | `false` | Enable OpenTelemetry export |
| `WORKPILOT_SEED_DEMO_DATA` | `false` | Seed Northstar demo workspace on startup |
| `WORKPILOT_EXECUTE_RUNS_INLINE` | `false` | Run workflows in the API process (local dev) |
| `WORKPILOT_ALLOW_TOOL_WRITES` | unset | Allow MCP/tool write operations (off by default) |

### Web (`.env.local` / docker-compose / Amplify)

| Variable | Description |
|---|---|
| `NEXT_PUBLIC_CONTROL_PLANE_URL` | API base URL (no trailing slash) |
| `NEXT_PUBLIC_COGNITO_CLIENT_ID` | Cognito app client ID |
| `NEXT_PUBLIC_COGNITO_REGION` | Cognito region |
| `NEXT_PUBLIC_DEMO_EMAIL` | Pre-fill email on login page |

Copy `.env.example` to `.env` to get started: `cp .env.example .env`

---

## AI models

| Model | ID | Cost | Notes |
|---|---|---|---|
| Amazon Nova Micro | `eu.amazon.nova-micro-v1:0` | $0.035/1M in · $0.14/1M out | Default. Fast, cheap, tool-calling. No form required. |
| Amazon Nova Lite | `eu.amazon.nova-lite-v1:0` | $0.06/1M in · $0.24/1M out | Better reasoning, still cheap |
| Claude Haiku 4.5 | `eu.anthropic.claude-haiku-4-5-20251001-v1:0` | $0.80/1M in · $4.00/1M out | Best quality. Requires Anthropic EU use-case form. |

Change the model by updating `WORKPILOT_BEDROCK_MODEL_ID` in the ECS task definition or `.env`.

---

## Architecture decisions

Key design decisions are documented as ADRs in `docs/adr/`:

- [ADR 0001 — Dual local and hosted data adapters](docs/adr/0001-dual-data-adapters.md) — FastAPI/PostgreSQL locally + Cloudflare D1 for hosted demo
- [ADR 0002 — Canonical workflow and native executor](docs/adr/0002-canonical-workflow-native-executor.md) — `workpilot.io/v1` schema as source of truth
- [ADR 0003 — Local authentication stub](docs/adr/0003-local-authentication-stub.md) — header-based tenant stub for local dev

Implementation rules for contributors are in [`AGENT.md`](AGENT.md).

---

## Checks

```bash
npm run typecheck
npm run lint
npm run build
npm run test

cd apps/api
pip install -e ".[dev]"
ruff check .
mypy app
pytest
```

---

## Security notes

- Never commit `.env`, `.env.local`, `.env.neon`, AWS credentials, or Cognito passwords
- `WORKPILOT_LOCAL_AUTH_ENABLED=true` is for local development only — set to `false` in staging/production
- All workflow and run queries are scoped to the authenticated tenant — no cross-tenant data leaks
- The executor rejects live external writes when `safe_mode=true` (the default)
- Audit records are hash-chained within each tenant
- Rotate the Cognito user password before sharing access beyond local development
- ECS tasks use an IAM task role — never embed AWS credentials in containers
