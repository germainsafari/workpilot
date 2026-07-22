# ADR 0001: Dual local and hosted data adapters

Status: accepted

## Context

The product brief requires a FastAPI/PostgreSQL/Redis local foundation, while the requested live demo must run on the Sites hosting platform. A paid external control plane is explicitly outside Phase 1.

## Decision

Keep the production-shaped local control plane in `apps/api` with PostgreSQL and Redis. Provide a small same-origin D1 adapter for the hosted demo using the same tenant, workflow, run, and audit concepts. The product UI remains provider-neutral and can point at FastAPI through `NEXT_PUBLIC_CONTROL_PLANE_URL`.

## Consequences

The live demo has durable structured state without paid infrastructure. Local development still exercises the requested FastAPI stack. Business schemas and safety invariants must remain aligned across both adapters.
