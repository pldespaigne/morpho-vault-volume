# Morpho Vault Net Flow Leaderboard

A Next.js app that tracks real capital movement (deposits − withdrawals) across [Morpho vaults](https://app.morpho.org/vaults) on Ethereum, valued at the time of each transaction. It displays a **top 10 / bottom 10 leaderboard** over selectable periods (7 days, 30 days, 12 months) with rank trend indicators.

See [BusinessCase.md](BusinessCase.md) for the full rationale.

<img width="974" height="641" alt="image" src="https://github.com/user-attachments/assets/de178a03-9f9e-47fb-a353-1e2be327a208" />

## Prerequisites

| Requirement | Detail |
|---|---|
| **Node.js** | ≥ 20 |
| **pnpm** | Pinned to `10.32.1` via the `packageManager` field in `package.json` |
| **Docker** | Used to run PostgreSQL 16 (see `docker-compose.yml`) |

## Setup

```bash
# 1. Configure environment variables (works by default no editing needed)
cp .env.example .env

# 2. Install dependencies (postinstall automatically runs prisma generate)
pnpm install

# 3. Generate GraphQL types (gitignored, required for compilation)
pnpm codegen

# 4. Start PostgreSQL
pnpm db:up

# 5. Push the Prisma schema to the database
pnpm db:push

# 6. (optional) Backfill historical data in db
pnpm fast-sync

# 7. Start the dev server (Next.js + Inngest dev server via npx — no separate install needed)
pnpm dev
```

The app is available at **http://localhost:3000** and the Inngest dashboard at **http://localhost:8288**.

### Useful commands

| Command | Description |
|---|---|
| `pnpm fast-sync` | One-shot backfill of all historical data (see below) |
| `pnpm test --run` | Run unit tests once |
| `pnpm db:studio` | Open Prisma Studio to browse the database |
| `pnpm db:down` | Stop the PostgreSQL container |
| `pnpm codegen` | Regenerate GraphQL types after editing queries |
| `pnpm build` | Production build |

## Architecture

### Tech stack

| Layer | Technology |
|---|---|
| Framework | Next.js 15 (App Router, Turbopack) / React 19 |
| Language | TypeScript 5.9 |
| Styling | Tailwind CSS 4 + shadcn/ui |
| Database | PostgreSQL 16 (Docker) |
| ORM | Prisma 7.5 with `@prisma/adapter-pg` |
| Background jobs | Inngest v3 (cron-triggered step functions) |
| Data fetching | `graphql-request` + GraphQL Code Generator |
| Resilience | `p-limit` (concurrency) / `p-retry` (retries with backoff) |

### Folder structure

| Path | Purpose |
|---|---|
| `app/` | Next.js pages and API route (`api/inngest/` serves the Inngest handler) |
| `components/` | React UI — leaderboard table, vault row, period/duration selectors (shadcn-based) |
| `inngest/` | Background cron functions (see Data flow below) |
| `lib/` | Core logic: `sync.ts` (shared sync functions), `leaderboard.ts` (cached query), `graphql/` (client, queries, paginator), `prisma.ts`, `env.ts` |
| `scripts/` | Standalone CLI scripts — `fast-sync.ts` (one-shot historical backfill) |
| `prisma/` | `schema.prisma` — data model (`Vault`, `DailyNetFlow`, `MonthlyNetFlow`, `SyncCursor`) |
| `generated/` | Auto-generated Prisma client & GraphQL types (do not edit) |

### Data flow

```
Morpho GraphQL API
        │
        ▼
  ┌─────────────────────────────── lib/sync.ts ───────────────────────────────┐
  │  fetchAndAggregateDailyBuckets()  ensureVaultsExist()                     │
  │  upsertDailyNetFlows()            aggregateMonthlyWindow()                │
  └───────────────────────────────────────────────────────────────────────────┘
        │                                       │
  Used by Inngest cron                    Used by fast-sync
  (incremental, 60-day batches)           (one-shot, full history)
        │                                       │
        ▼                                       ▼
 fetchVaultTransactions  ← every 10 min    pnpm fast-sync
 aggregateMonthlyNetFlows ← every hour     (scripts/fast-sync.ts)
        │                                       │
        └───────────────┬───────────────────────┘
                        ▼
   DailyNetFlow / MonthlyNetFlow / Vault tables
                        │
                        ▼
         getLeaderboardData()            ← "use cache" + revalidateTag
         (lib/leaderboard.ts)              Returns top/bottom 10 for current & previous period
                        │
                        ▼
                    React UI               Period toggle (7d/30d/12m), rank trends, vault links
```

### Key design notes

- **Shared sync module** (`lib/sync.ts`) — the core data-ingestion logic (fetch, aggregate, upsert) lives in pure async functions reused by both the Inngest cron jobs and the fast-sync CLI script.
- **Fast-sync script** (`scripts/fast-sync.ts`) — a standalone `tsx` script (`pnpm fast-sync`) that backfills the entire transaction history in one run. It reads the sync cursor once, fetches all transactions via the paginator, writes daily + monthly rows in chunked DB transactions, and updates cursors at the end. Ideal for first-time setup or full re-sync. Otherwise CRON jobs will eventually backfill all historical data, but it will take a long time.
- **Two-tier aggregation** — raw transactions are netted into `DailyNetFlow`, then rolled into `MonthlyNetFlow`. The 7d/30d views query the daily table; 12m queries the monthly table.
- **`"use cache"` + `revalidateTag`** — leaderboard data is cached at the server level and invalidated on-demand by the Inngest aggregation job after writing new data.
- **Cursor-based sync** — the transaction fetcher tracks a `SyncCursor` and caps its query window at complete UTC days, ensuring idempotent upserts.
- **Resilient GraphQL paginator** (`lib/graphql/paginate.ts`) — concurrent page fetching with rate-limit-aware retries, exponential backoff + jitter, and automatic page-size reduction on "query too complex" errors.
