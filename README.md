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
3. Set required secret env vars:
   - `ETHERSCAN_API_KEY`
   - `GOOGLE_CLIENT_ID`
   - `GOOGLE_CLIENT_SECRET`
4. Create the blueprint.

## Google OAuth login

Server now supports Google login with HttpOnly session cookie.

Required env vars for `tracker-web`:
- `SESSION_SECRET` (random long secret)
- `APP_URL` (e.g. `https://tracker-web-9d6e.onrender.com`)
- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`
- `GOOGLE_REDIRECT_URI` (e.g. `https://tracker-web-9d6e.onrender.com/auth/google/callback`)

Google Cloud Console setup:
1. Create OAuth client (Web application).
2. Add Authorized redirect URI = `GOOGLE_REDIRECT_URI`.
3. Add authorized origin = app URL.

Routes:
- `GET /auth/google`
- `GET /auth/google/callback`
- `GET /auth/logout`
- `GET /api/auth/me`

Render will provide URL like:
- `https://tracker-web.onrender.com`

Healthcheck endpoint:
- `/health`

## Deduplication rule

ERC-20 transfer uniqueness key: `txHash + logIndex`.

This avoids duplicates on re-sync and handles multiple `Transfer` events inside one tx.
