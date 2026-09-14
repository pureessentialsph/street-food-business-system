# Street Food Business System

Command center for a multi-branch, multi-cart Filipino street-food operation: recipe
costing, shift reconciliation, vendor compensation, inventory, procurement and P&L.

Build document: [`spec.md`](./spec.md) · Formulas: [`docs/DOMAIN.md`](./docs/DOMAIN.md)

## Status

**Phase 0 — Foundation: complete.** Auth, RBAC, tenant-scoped data access, money/unit/
business-date libraries, seed, CI. Phase 1 (master data) is next; see spec §12.

## Stack

Next.js 15 (App Router) · TypeScript strict · PostgreSQL + Prisma · Auth.js v5 ·
Tailwind · Vitest. Money and quantities are `Decimal(14,4)` — never floats.

## Running it locally

Node 22 and pnpm 9 are required. This machine keeps Node in `~/.local/node`, so:

```bash
export PATH="$HOME/.local/node/bin:$PATH"
```

```bash
pnpm install
pnpm db:local          # embedded Postgres on :54329 — no Docker or Homebrew needed
cp .env.example .env   # the defaults already point at the local database
pnpm db:push
pnpm db:seed
pnpm dev               # http://localhost:3000
```

Seeded logins (company code `SFS`, password `ChangeMe123!`):

| Email | Role | Sees |
|---|---|---|
| `owner@streetfood.local` | Owner | Everything, all branches |
| `areamanager@streetfood.local` | Area Manager | BR-01, BR-02 · approves shifts |
| `supervisor1@streetfood.local` | Supervisor | BR-01 only |
| `supervisor2@streetfood.local` | Supervisor | BR-02 only |
| `commissary@streetfood.local` | Commissary | CMY-01 |
| `hr@streetfood.local` | HR | Employee module |

The seed also creates a second company (`TENANT2`) reusing the owner's email. It exists
so the tenant-isolation tests have something real to fail against — that is why login
asks for a company code when an email is ambiguous.

## Commands

```bash
pnpm test        # 36 tests; DB-backed ones skip without DATABASE_URL
pnpm typecheck
pnpm lint
pnpm build
pnpm db:studio
pnpm db:local:stop
```

## Rules that are not negotiable

1. No floats for money or quantities. `Decimal(14,4)`; round half-up at display only.
2. Business math lives in pure functions under `src/lib/engines/` with no DB access.
3. The inventory ledger is append-only; corrections are new `ADJUSTMENT` rows.
4. Cost is snapshotted, never recomputed retroactively.
5. Every mutation writes an `AuditLog` row.
6. The seed is idempotent.
7. Business date, not timestamp, is the reporting key.
8. Every table carries `companyId`; all access goes through `scopedDb()`.
9. Piece↔stick conversion happens only in `src/lib/units.ts`.

## Deployment

GitHub → Vercel → Supabase. Vercel needs `DATABASE_URL` (Supabase pooled, port 6543,
`?pgbouncer=true`), `DIRECT_URL` (port 5432, for migrations), `AUTH_SECRET` and
`AUTH_URL`. See `.env.example`.
