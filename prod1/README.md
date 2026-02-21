# prod1

Production-grade documentation space (source of truth).

## Structure
- `prd/` — product requirements
- `adr/` — architecture decision records
- `architecture/` — diagrams and module boundaries
- `api/` — API contracts (OpenAPI)
- `runbooks/` — operational procedures
- `analytics/` — metrics/events definitions
- `releases/` — release notes and changelog entries
- `templates/` — reusable templates

## Rules
1. Behavior change in code => update docs here in same PR.
2. No merge without updated spec/runbook when applicable.
3. Keep docs concise, testable, and versioned.
