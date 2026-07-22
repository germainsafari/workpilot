# WorkPilot implementation rules

WorkPilot is a governed, no-code workflow product for non-technical business teams. User-facing copy must avoid model, prompt, token, state-machine, and agent-framework terminology.

The current repository implements Phase 1 only: tenant-scoped workflow storage, canonical workflow validation, workflow CRUD, deterministic safe execution, run history, audit events, the visual builder, local services, and tests. Do not add AWS, Bedrock, CrewAI, LangGraph, or paid infrastructure until Phase 1 is verified and a later phase is explicitly requested.

Safety invariants:

- Every database query is tenant-scoped.
- External writes remain in dry-run mode.
- Structured inputs and outputs are validated.
- Idempotency keys prevent duplicate runs.
- Secrets are never committed, logged, or placed in workflow data.
- Terraform or paid infrastructure is never applied automatically.
