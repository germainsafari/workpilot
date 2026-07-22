# ADR 0002: Canonical workflow and native executor

Status: accepted

## Context

Workflow definitions must not be stored as framework-specific code, and deterministic operations must not be delegated to autonomous reasoning systems.

## Decision

Use the versioned `workpilot.io/v1` canonical Pydantic schema as the source of truth. The Phase 1 native executor handles supported steps explicitly. AI-assisted steps use a deterministic structured mock; tool steps are allowlisted and dry-run only; conditions, waits, and end states execute as ordinary code.

## Consequences

Tests are repeatable, live writes remain impossible in Phase 1, and later runtime adapters can compile from the same validated definition without changing stored workflows.
