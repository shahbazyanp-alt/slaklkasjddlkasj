# Runbook: Deploy

## Preconditions
- Main branch green
- Required env vars set in Render

## Steps
1. Push to `main`.
2. Verify Render auto-deploy started.
3. Check health endpoint: `/health`.
4. Smoke check key pages/API.

## Rollback
- Render -> previous successful deploy -> Rollback.
