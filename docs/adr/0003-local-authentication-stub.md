# ADR 0003: Local authentication stub

Status: accepted

## Context

Phase 1 needs tenant-scoped development and testing without requiring Cognito or third-party sign-in credentials.

## Decision

Accept a signed JWT when provided. In local mode only, fall back to the seeded Northstar Projects user and allow explicit tenant/user headers for isolation tests. Local fallback can be disabled with `WORKPILOT_LOCAL_AUTH_ENABLED=false`.

## Consequences

The full tenant boundary can be tested locally without credentials. The stub is not a production identity provider and must be disabled before deploying the FastAPI control plane to a shared environment.
