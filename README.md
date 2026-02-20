# Crypto Payment Tracker (Ethereum ERC-20)

MVP dashboard for tracking incoming/outgoing ERC-20 transfers across many wallets (200+), filtered by a whitelist of token contracts (spam tokens ignored).

## MVP scope

- Network: Ethereum only
- Assets: ERC-20 only (native ETH excluded)
- Data source: Etherscan API
- Transfers: incoming + outgoing, confirmed only
- Wallet input: manual copy/paste
- Wallet tags: yes
- Reports:
  - transaction table with filters (date range, direction, token, wallet, tags)
  - summary by token and by wallet
  - CSV/XLSX export
- Auth/RBAC:
  - `admin`
  - `read_only`

## High-level architecture

- `apps/web` — Next.js app (UI + API)
- `apps/worker` — background sync jobs (BullMQ)
- `packages/etherscan-client` — Etherscan adapter
- `packages/reporting` — summary/export logic
- `packages/db` — Prisma schema and migrations

## Runbook (local)

1. Configure env variables (`ETHERSCAN_API_KEY`, `DATABASE_URL`, `REDIS_URL`)
2. Run database migrations
3. Start web service
4. Start worker service

## Deploy on Render (no custom domain)

This repository includes `render.yaml` blueprint for:
- `tracker-web` (public web service)
- `tracker-worker` (background sync)
- `tracker-postgres` (managed Postgres)
- `tracker-redis` (managed Redis)

### Steps

1. Push this repo to GitHub/GitLab.
2. In Render: **New + → Blueprint** and select the repo.
3. Set required secret env var:
   - `ETHERSCAN_API_KEY`
4. Create the blueprint.

Render will provide URL like:
- `https://tracker-web.onrender.com`

Healthcheck endpoint:
- `/health`

## Deduplication rule

ERC-20 transfer uniqueness key: `txHash + logIndex`.

This avoids duplicates on re-sync and handles multiple `Transfer` events inside one tx.
