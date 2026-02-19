# Architecture (MVP)

## 1) apps/web

Purpose: user-facing dashboard + admin settings + API.

Contains:
- auth (email/password)
- role-based access (`admin`, `read_only`)
- wallet management (add/remove/tag)
- whitelist contract management (contract + token name)
- transactions list with filters
- summary pages
- export endpoints

If removed: no UI/control plane.

## 2) apps/worker

Purpose: async synchronization from Etherscan.

Jobs:
- `wallet.backfill` — historical load for wallet
- `wallet.sync` — incremental updates by interval
- `wallet.refresh` — manual refresh trigger

If removed: web app gets overloaded and sync does not scale to 200+ wallets.

## 3) packages/etherscan-client

Purpose: isolate provider-specific API calls/retries/pagination/rate-limit behavior.

If removed: provider logic leaks into business modules.

## 4) packages/reporting

Purpose: summary and export logic isolated from sync.

Outputs:
- totals by token
- totals by wallet
- filtered exports (CSV/XLSX)

If removed: reporting logic gets mixed with storage/sync.

## 5) packages/db

Purpose: data model + migrations via Prisma.

Core entities:
- users/roles
- wallets/tags
- token whitelist
- erc20 transfer ledger
- sync cursors/states

If removed: no durable history and no reliable reporting.
