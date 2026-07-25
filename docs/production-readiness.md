# WorkPilot production-readiness & AWS architecture guide

Last updated: 2026-07-23

This document is the roadmap from the current Phase 1 foundation to a
production system on AWS. It is written to line up with the target platform
stack: AWS-first, IaC with Terraform, serverless + EKS, agent frameworks
(LangGraph / Strands) on Bedrock AgentCore, MCP/A2A tool protocols, and
OpenTelemetry-based observability.

---

## 1. Where the product stands today

**Architecture (as built):**

- **Frontend** — Next.js 16 (via `vinext`) product UI with all nine areas
  (Home, Workflows, Templates, Runs, Approvals, Connections, Team, Analytics,
  Settings), a React Flow canvas, and a safe test overlay. Ships two data
  adapters: static demo data and a same-origin `/v1/*` API backed by
  Cloudflare D1 (SQLite).
- **Control plane** — FastAPI (`apps/api`) with tenant-scoped workflow CRUD,
  run creation, and audit endpoints. SQLAlchemy async models + Alembic
  migrations for `tenants`, `users`, `workflows`, `workflow_versions`,
  `workflow_runs`, `step_runs`, `audit_events`.
- **Execution** — a **deterministic native executor** that walks the canonical
  workflow graph (ai_task / condition / wait / tool / end). AI steps use a
  `DeterministicMockModel`; tool steps are **dry-run only**. Redis-backed worker
  mode plus inline execution for local tests.
- **Safety primitives already present** — tenant scoping on every query,
  idempotency keys on runs, hash-chained audit events, dry-run enforcement.

**What is real vs. simulated:**

| Capability | Today | Production target |
|---|---|---|
| Database | Neon Postgres (integrated ✅) / local PG / SQLite | Aurora Serverless v2 PostgreSQL or RDS PostgreSQL Multi-AZ |
| AI steps | Deterministic mock | Bedrock models via an agent runtime (LangGraph/Strands) |
| Tool actions | Dry-run only | Real connectors behind MCP servers + approval gate |
| Auth | Local header/JWT stub | SSO/OIDC (Cognito or enterprise IdP) + SigV4 for service-to-service |
| Approvals | UI-only | Durable pause/resume (Step Functions callbacks) |
| Secrets | `.env` | Vault + AWS Secrets Manager |
| Observability | structlog request logs | OpenTelemetry (ADOT) → X-Ray + CloudWatch |
| Infra | Docker Compose | Terraform → EKS/Fargate + serverless |

---

## 2. What was completed in this pass

- **Neon Postgres integration.** `app/db.py` now normalizes managed-Postgres
  URLs: it strips libpq-only query params (`sslmode`, `channel_binding`) that
  asyncpg rejects and negotiates TLS via `ssl=True`. Alembic uses the same
  normalization, so migrations and the app share one code path.
- **Schema applied to Neon** via `alembic upgrade head`.
- **Comprehensive demo workspace** loaded (`app/demo_seed.py`, `make seed-demo`):
  the Northstar Projects tenant, a 5-person team, 5 workflows across
  departments (active/paused/draft, low→high risk), published versions, 11 runs
  spread over time (completed / waiting / failed) with 42 step runs carrying
  real executor outputs, and a 29-event **hash-chained audit trail that
  re-validates** against the production `record_audit` algorithm.
- **Verified end-to-end**: the FastAPI control plane boots against Neon and
  serves the seeded workflows and runs over HTTP; backend tests, ruff, and mypy
  all pass.

> Credentials live only in the git-ignored `apps/api/.env.neon`. Copy it to
> `apps/api/.env` to point the control plane at Neon. **Rotate the Neon
> password** before real use — it was shared in plaintext over chat.

---

## 3. Target AWS architecture

```
                            ┌──────────────────────────────────────────────┐
   Users ── CloudFront ──►  │  ALB / API Gateway (SigV4, WAF, Cognito OIDC)  │
                            └───────────────┬──────────────────────────────┘
                                            │
                     ┌──────────────────────┼───────────────────────────┐
                     ▼                       ▼                           ▼
              Control plane            Agent runtime               Async workers
              FastAPI on EKS      Bedrock AgentCore Runtime        SQS + Lambda /
              (Fargate profile)   (LangGraph & Strands agents)     Step Functions
                     │                       │                           │
                     │                   MCP servers (tools)             │
                     │                 A2A delegation (SigV4)            │
                     ▼                       ▼                           ▼
           Aurora Serverless v2      Bedrock models          Durable orchestration:
           PostgreSQL (Multi-AZ)   (Claude on Bedrock)        Step Functions +
                     │                                        approval callbacks
                     ▼
           Secrets Manager + Vault  •  OTel/ADOT → X-Ray + CloudWatch  •  OpenSearch/Splunk
```

### 3.1 Compute
- **EKS (Fargate profile)** for the FastAPI control plane and long-lived MCP
  servers. Matches the platform's k8s/EKS domain; Fargate removes node ops.
- **Lambda + Step Functions** for the async execution path: run orchestration,
  durable `wait`/approval pauses (Step Functions `waitForTaskToken`), retries,
  and scheduled triggers (EventBridge Scheduler for the "Mondays 09:00" style).
- **Fargate tasks** for heavier or longer agent runs that exceed Lambda limits.

### 3.2 Agent runtime (the core of the JD)
- **Bedrock AgentCore Runtime** hosts agents via `BedrockAgentCoreApp` with a
  standard invocation lifecycle. This replaces `DeterministicMockModel`.
- **Dual-framework strategy** — the canonical workflow definition compiles to
  either:
  - **LangGraph** (`create_react_agent`, `StateGraph`, `ToolNode`) for
    graph-structured, supervisor/hierarchical flows, or
  - **Strands Agents SDK** (`@tool`, `StrandsA2AExecutor`) for A2A-native flows.
  Keep a thin `AgentRuntime` interface so both plug in behind the executor
  (the current `NativeExecutor` becomes one of several runtimes).
- **Orchestration patterns**: ReAct for single-agent steps, a **supervisor**
  agent for multi-step workflows, and **A2A delegation** between specialized
  agents (extract / classify / draft), with hierarchical flows for approvals.

### 3.3 Tool integration — MCP / A2A
- Expose each connector (Gmail, Drive, Slack, internal record systems) as an
  **MCP server**. Agents consume them via `langchain-mcp-adapters`.
- **SigV4-sign** all MCP/A2A calls so tool access is IAM-scoped per tenant/role.
- Every tool call still passes the **dry-run/approval gate**: mutating
  operations require an approval token before the executor lets them run live.

### 3.4 Declarative config
- The canonical workflow (already a versioned JSON/graph) becomes a
  **YAML + Pydantic** contract: agent behavior, model choice, tool bindings,
  guardrails, and runtime (LangGraph vs Strands) all declared per step. The
  existing `CanonicalWorkflow` Pydantic schema is the seed for this.

### 3.5 Data & state
- **Aurora Serverless v2 PostgreSQL** (Multi-AZ) as the system of record. The
  current schema and Alembic migrations port directly; Neon is a drop-in for
  dev/staging.
- **RDS Proxy** for connection pooling from Lambda.
- **ElastiCache (Redis)** replaces the local Redis queue, or use **SQS** for the
  serverless path.
- **S3** for artifacts (transcripts, generated briefs, exports) with
  per-tenant prefixes and KMS encryption.

### 3.6 Identity & access
- **Cognito** (or federate the enterprise IdP via SAML/OIDC) replaces the local
  auth stub; issue short-lived JWTs. Keep the `Principal` abstraction.
- **IAM + SCPs** across AWS Organizations for environment isolation; per-tenant
  role assumption for data-plane calls.
- **Hashicorp Vault** for dynamic DB credentials and connector secrets;
  **Secrets Manager** for AWS-native rotation (JWT signing key, model keys).

### 3.7 Observability (SRE)
- **aws-opentelemetry-distro (ADOT)**: instrument FastAPI, the agent runtime,
  and workers; export **traces to X-Ray** and **metrics/logs to CloudWatch**.
  Propagate a `trace_id` per run (the schema already has one).
- Ship logs to **Splunk** (or OpenSearch) for the platform's SRE tooling; wire
  alerts to **OpsGenie**.
- SLOs: run success rate, step latency, approval wait time, model cost/run.

### 3.8 Networking & edge
- **VPC** with private subnets for EKS/RDS, **VPC endpoints** for Bedrock/S3/
  Secrets Manager (no public egress for data-plane).
- **CloudFront + WAF** in front of the UI and API; **ACM** for TLS.
- Hybrid networking (Transit Gateway / Direct Connect) if connectors reach
  on-prem systems.

---

## 4. Concrete AWS resource checklist

**Networking:** VPC, public+private subnets (3 AZ), NAT, Internet Gateway, VPC
endpoints (Bedrock, S3, Secrets Manager, ECR, CloudWatch), Transit Gateway
(hybrid), Route 53, ACM, CloudFront, WAF.

**Compute:** EKS cluster + Fargate profiles, ECR repos, Lambda functions, Step
Functions state machines, EventBridge Scheduler, SQS queues + DLQs.

**AI:** Bedrock model access (Claude), Bedrock AgentCore Runtime, MCP server
tasks (Fargate), guardrails config.

**Data:** Aurora Serverless v2 PostgreSQL (Multi-AZ) + RDS Proxy, ElastiCache
Redis, S3 buckets (artifacts, logs, IaC state), KMS keys.

**Identity/secrets:** Cognito user/identity pools (or IdP federation), IAM roles
& policies, AWS Organizations + SCPs, Secrets Manager, Vault (self-managed on
EKS or HCP).

**Observability:** CloudWatch (logs, metrics, dashboards, alarms), X-Ray, ADOT
collector, OpenSearch or Splunk forwarder, OpsGenie integration.

**Delivery:** Terraform (Terraform Enterprise/Cloud) + Terratest, CodePipeline
or GitHub Actions, ECR image scanning, Chalice for lightweight Lambda APIs if
desired.

---

## 5. Gap analysis (what must be built)

**P0 — required for any production traffic**
1. Real authentication (Cognito/IdP), remove `WORKPILOT_LOCAL_AUTH_ENABLED`.
2. Managed Postgres (Aurora/Neon) — **done for dev via Neon**; rotate the leaked
   credential and move it to Secrets Manager/Vault.
3. Secrets out of `.env` into Secrets Manager/Vault.
4. Real model provider: swap `DeterministicMockModel` for a Bedrock-backed
   `AgentRuntime` (start with one framework, e.g. LangGraph ReAct).
5. Durable approvals: Step Functions callback pattern for `wait`/approval steps.
6. TLS, WAF, CORS lockdown, rate limiting.

**P1 — reliability & governance**
7. OpenTelemetry/ADOT tracing to X-Ray + CloudWatch; OpsGenie alerts.
8. Real connectors as MCP servers with SigV4 + per-tenant IAM.
9. CI/CD + Terraform IaC with Terratest; blue/green or canary deploys.
10. Backups/PITR, Multi-AZ, autoscaling, DR runbook.
11. Cost controls: model routing, token budgets per tenant, run cost caps.

**P2 — platform maturity**
12. Dual-framework (LangGraph **and** Strands) with A2A delegation.
13. Declarative YAML+Pydantic agent config and framework governance.
14. Evaluation gates for agent quality; guardrails; red-teaming.
15. Analytics pipeline (usage, savings, success rate) off the audit/run data.

---

## 6. Phased roadmap

- **Phase 2 — Foundations on AWS (4–6 wks):** Terraform baseline (VPC, EKS,
  Aurora, ECR, Secrets Manager), Cognito auth, control plane on EKS/Fargate,
  Neon→Aurora path, CI/CD. Exit: authenticated app on AWS, no mocks in infra.
- **Phase 3 — Real execution (4–6 wks):** Bedrock AgentCore + one framework
  (LangGraph ReAct), Step Functions run orchestration with durable approvals,
  SQS/Lambda workers, ADOT tracing. Exit: a real workflow runs a real model
  with human approval and full traces.
- **Phase 4 — Connectors & governance (6–8 wks):** MCP servers for the first
  connectors (Gmail/Drive/Slack), SigV4, live writes behind approval; Vault
  dynamic secrets; Splunk/OpsGenie SRE. Exit: first production tenant workflow.
- **Phase 5 — Platform (ongoing):** Strands + A2A delegation, YAML/Pydantic
  config system, evaluation gates, multi-region/DR, cost governance.

---

## 7. Immediate next actions

1. **Rotate the Neon password** and store it in Secrets Manager/Vault.
2. Stand up the Terraform baseline (VPC + Aurora + ECR + Secrets Manager).
3. Introduce an `AgentRuntime` interface; implement a Bedrock LangGraph runtime
   behind the existing executor seam.
4. Replace the auth stub with Cognito/OIDC.
5. Add ADOT instrumentation and a `trace_id`-keyed CloudWatch/X-Ray dashboard.
