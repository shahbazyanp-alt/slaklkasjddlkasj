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

## Runbook (planned)

1. Configure env variables (`ETHERSCAN_API_KEY`, `DATABASE_URL`, `REDIS_URL`)
2. Run database migrations
3. Start web service
4. Start worker service

## Deduplication rule

ERC-20 transfer uniqueness key: `txHash + logIndex`.

This avoids duplicates on re-sync and handles multiple `Transfer` events inside one tx.
