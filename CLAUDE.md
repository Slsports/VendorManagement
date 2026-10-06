# RetailHQ VMS — read this first

Vendor Management System for Shaver Lake Sports Inc. (stores SLS, SLH, SLM, GS). Owner and admin:
Dana Powell (non-technical; son Nick is backup). Live at https://vms.shaverlakesports.com, auto-deployed
by Vercel from the branch `claude/ecstatic-carson-ziz2a9`.

## Where the truth lives
- `docs/decisions.md` — Dana's decisions, newest at the bottom. **It overrides both specs.** Read the
  last 300 lines before doing anything; append an entry whenever Dana decides something.
- `docs/vendor-pipeline-and-platform-spec.md` (its §12 overrides `docs/development-strategy.md`).
- `docs/lightspeed-category-standard.md` — mirror of the Claude Doc Dana and Trevor sign off:
  https://claude.ai/code/artifact/81009418-193c-498a-8e62-5c8b7c8a847c
- `README.md` — script table and setup.

## How Dana works with Claude
- Keep replies brief and plain; she is the shop owner, not a developer. No code in prose.
- Commit and push as you go on `claude/ecstatic-carson-ziz2a9`. Never create a PR unless asked.
- Secrets live in `.env` locally and in hosted environment variables, never in the repo or in chat.
- Say "Vendor ID" for the vendor's item number. Call Lightspeed "LS" is fine; Worldwide Distributors is
  "WWD". Nothing in Lightspeed changes until VMS is connected to it and each batch is approved.
- Only Dana is an admin. Trevor and Jarrett are managers. Do not promote anyone.
- Dana reviews proposals before data changes: duplicates, renames, category changes go through the
  review queue, never applied silently.

## Stack and commands
Vite + React 19 + TypeScript + Tailwind 4, Supabase (project `bpdpkytfmpbwpbmpejbf`), vitest, oxlint.
- `npm run lint`, `npm run typecheck`, `npm test` — run all three before every push.
- `npm run db:test` — applies every migration plus `supabase/tests/*.test.sql` to local Postgres 16
  (`pg_ctlcluster 16 main start` first). Add a `.test.sql` for every migration.
- `NODE_USE_ENV_PROXY=1 npm run db:migrate` — applies pending migrations to the hosted project through
  the Supabase Management API (the cloud proxy injects the token; it throttles, `scripts/db.mjs` retries).
- Ad-hoc hosted SQL: write a scratch `.mjs` that imports `query` from `scripts/db.mjs` and run it with
  `NODE_USE_ENV_PROXY=1`. The proxy does **not** carry the service-role key, so `db:create-user` and
  storage uploads do not work from a cloud session; auth users were created with SQL into `auth.users`.
- Every migration grants explicitly (hosted default privileges give nothing) and adds RLS policies.
  Helpers: `user_in_org`, `user_can_edit` (admin/manager/buyer), `is_admin`.
- Types are hand-maintained in `src/types/database.ts`; add Row/Insert/Update and function Returns for
  every schema change, then aliases in `src/types/index.ts`.

## What exists (October 2026)
Vendors (778, with routes WWD / Faire / direct, standing fine/hold/last resort/do-not-order with reason
tags, free-shipping policy and threshold, freight routing, fishing flag, WWD zero-upcharge), rep groups,
lines (catalog-only names, never vendors unless promoted), five show listings, Worldwide contacts,
orders (1,104 from the Seasonal Buying Guide; the Placed Order Summary v2.0 is still to come), review
queue with assignment rules, vendor scorecards (six dimensions, four automatic), item-level buying
rules per vendor (seeded for Ty), Lightspeed category standard document.

## Not built yet, in order
Gmail connection (orders@ on Google Workspace, migration done Oct 7), Placed Order Summary v2.0 import,
Needs list, Lightspeed API connection, category and item clean-up tool, replenishment check, pattern
engine, show-prep view. Target: running well by December 2026 for the WWD show Jan 25-28, 2027.
