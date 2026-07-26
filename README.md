# WorkPilot

WorkPilot is a no-code agentic operations platform — a studio where non-technical teams describe business processes as visual workflows, test them safely with real AI, and monitor every run with full cost and audit transparency.

**Live deployment:** set `NEXT_PUBLIC_CONTROL_PLANE_URL_STAGING` in your local `.env`  
**AI runtime:** Amazon Bedrock · Amazon Nova Micro (eu-central-1 cross-region inference)  
**Auth:** AWS Cognito user pool (eu-central-1)

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

---

## Authentication

### Staging (AWS Cognito)

Login URL: http://localhost:3001/login (or the UI wherever it's hosted)

Use the credentials in your local `.env` file:

| Field | Env var |
|---|---|
| Email | `DEMO_COGNITO_EMAIL` |
| Password | `DEMO_COGNITO_PASSWORD` |
| Cognito pool | `WORKPILOT_COGNITO_USER_POOL_ID` |
| Client ID | `NEXT_PUBLIC_COGNITO_CLIENT_ID` |

The JWT is stored in `localStorage` as `wp-jwt` and sent as `Authorization: Bearer <token>` on every API call.

### Local Docker (no Cognito)

Set `WORKPILOT_LOCAL_AUTH_ENABLED=true` in docker-compose.yml (already the default). Any request with the header `X-WorkPilot-Tenant-ID: tenant-northstar` is accepted without a token.

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

## MCP server integration

MCP (Model Context Protocol) lets you connect any tool server to your AI agents. WorkPilot's AI executor can call MCP tools as workflow steps.

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

Set the public frontend vars on the Worker (they are read at build time from `.env`,
and can also be set as Worker vars/secrets):

```
NEXT_PUBLIC_CONTROL_PLANE_URL   # the AWS ALB URL
NEXT_PUBLIC_COGNITO_CLIENT_ID
NEXT_PUBLIC_COGNITO_REGION
```

> **Note:** the generated `wrangler.json` includes a placeholder D1 binding
> (`database_id: 00000000-…`). If you enable D1-backed features, create a real
> database (`npx wrangler d1 create workpilot`) and replace the id; otherwise the
> binding is unused because the app talks to the AWS API.

> **Vercel?** Not supported out of the box — Vercel expects a `next build` output,
> but this repo produces a Cloudflare Worker. Hosting on Vercel would require
> migrating the frontend off `vinext` to standard Next.js.

### Add a custom domain

1. Register a domain (e.g. app.yourcompany.com) in Route 53
2. Create an HTTPS listener on the ALB with an ACM certificate
3. Point a CNAME to the ALB DNS or Amplify/Vercel URL

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
| `WORKPILOT_AGENT_RUNTIME` | `deterministic_mock` | `deterministic_mock` \| `bedrock_langgraph` |
| `WORKPILOT_BEDROCK_MODEL_ID` | `eu.amazon.nova-micro-v1:0` | Bedrock model (cross-region profile) |
| `WORKPILOT_BEDROCK_REGION` | `eu-central-1` | Bedrock region |
| `WORKPILOT_CORS_ORIGINS` | `http://localhost:3000` | Comma-separated allowed origins |
| `WORKPILOT_OTEL_ENABLED` | `false` | Enable OpenTelemetry export |
| `WORKPILOT_SEED_DEMO_DATA` | `false` | Seed Northstar demo workspace on startup |

### Web (`.env.local` / docker-compose / Amplify)

| Variable | Description |
|---|---|
| `NEXT_PUBLIC_CONTROL_PLANE_URL` | API base URL (no trailing slash) |
| `NEXT_PUBLIC_COGNITO_CLIENT_ID` | Cognito app client ID |
| `NEXT_PUBLIC_COGNITO_REGION` | Cognito region |
| `NEXT_PUBLIC_DEMO_EMAIL` | Pre-fill email on login page |

---

## AI models

| Model | ID | Cost | Notes |
|---|---|---|---|
| Amazon Nova Micro | `eu.amazon.nova-micro-v1:0` | $0.035/1M in · $0.14/1M out | Default. Fast, cheap, tool-calling. No form required. |
| Amazon Nova Lite | `eu.amazon.nova-lite-v1:0` | $0.06/1M in · $0.24/1M out | Better reasoning, still cheap |
| Claude Haiku 4.5 | `eu.anthropic.claude-haiku-4-5-20251001-v1:0` | $0.80/1M in · $4.00/1M out | Best quality. Requires Anthropic EU use-case form. |

Change the model by updating `WORKPILOT_BEDROCK_MODEL_ID` in the ECS task definition or `.env`.

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
