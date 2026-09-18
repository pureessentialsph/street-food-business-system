# Street Food Business System

Multi-branch, multi-cart Filipino street-food operation. Built for one company, built
tenant-ready (`companyId` on every model) so it can be sold to other cart operators.

`spec.md` is the authoritative description of the domain and the confirmed business
decisions. Read it before changing anything that touches money, units or pay.

## The guide must not go stale

`/guide` (`src/app/(app)/guide/page.tsx`) is a written tutorial for the people who run
the business, not for developers.

**Whenever a change alters what a user does or sees, update the guide in the same
commit.** That includes: a new screen or nav entry, a changed flow, a new required
field, a renamed concept, a changed default, a new warning or refusal, a change to who
can do what.

A screen that changed with a guide that did not is worse than no guide, because people
trust it. If a change does not affect how the system is used — a refactor, a test, a
performance fix — leave the guide alone and say so in the commit.

## Rules that are not negotiable

- **Money and quantities are `Decimal`, never floats.** `Decimal(14,4)` in Prisma,
  strings from forms all the way through. Never `Number()` a peso figure.
- **Nothing touches a bare `PrismaClient`.** Use `scopedDb(companyId)`, which injects
  the tenant into every read and write. A forgotten `where` must not leak another
  operator's data.
- **The inventory ledger is append-only.** Corrections post reversing entries; rows are
  never edited or deleted. `StockBalance` is a cache and must be rebuildable from it.
- **Engines under `src/lib/engines/` are pure** — no database, no session. Business
  rules live there so they can be tested without a login.
- **Business rules belong in data, not code.** Prices, set definitions, compensation
  schemes and thresholds are all editable by the owner.
- **Segregation of duties.** The person who closes a shift cannot approve it; the person
  who records an expense cannot approve it; the person who creates a payroll run cannot
  approve it.
- Validate every input boundary with Zod. Every server action returns `ActionResult` and
  never throws at the form.

## Working here

- `pnpm dev` — needs the local database: `pnpm db:local` first.
- `pnpm test` — Vitest. Some suites need `DATABASE_URL` and a seeded database.
- `pnpm exec tsc --noEmit` before committing.
- Migrations: `pnpm db:migrate` locally, `prisma migrate deploy` against production with
  `.env.production.local` loaded. That file is gitignored and must stay untracked.
- Deploys are `vercel deploy --prod`; the project is pinned to `sin1` to sit beside the
  Supabase database in `ap-southeast-1`.

## Verification

Prefer checking the real thing over assuming. The browser tools can drive the local app;
the seeded owner login is in `prisma/seed.ts`. When a fix concerns data, read the row
back rather than trusting the success message.
