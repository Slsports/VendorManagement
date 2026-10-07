# RetailHQ VMS — Vendor Management System

Vendor and order management for Shaver Lake Sports Inc. (Shaver Lake Sports, Shaver Lake Hardware,
Shaver Lake Marina, The Happy Camper General Store), built multi-tenant from day one.

Specs live in [`docs/`](docs/): `development-strategy.md` is the build plan,
`vendor-pipeline-and-platform-spec.md` extends and (per its §12) overrides it, and
`decisions.md` records later decisions that override both.

## Stack

React 19 + Vite + TypeScript · Tailwind CSS 4 · Supabase (Postgres, Auth, Storage, RLS) · Vercel.

## Local setup

1. Install Node 22 or newer.
2. `npm install`
3. Copy `.env.example` to `.env` and fill in the values from the Supabase dashboard
   (Project Settings → API). `.env` is git-ignored; never commit it.
4. `npm run dev` and open http://localhost:5173

## Database

Migrations are plain SQL in `supabase/migrations/` and apply in filename order.

| Command | What it does |
|---|---|
| `npm run db:migrate` | Applies pending migrations to the hosted project through the Supabase Management API. Needs `SUPABASE_PROJECT_REF` and `SUPABASE_ACCESS_TOKEN` (a personal access token from https://supabase.com/dashboard/account/tokens). |
| `npm run db:migrate -- --dry` | Shows which migrations would run. |
| `npm run db:create-user -- --email you@example.com --name "Your Name" --role admin --password "…"` | Creates a login. Needs `SUPABASE_SERVICE_ROLE_KEY`. Omit `--password` to send an invite email instead; add `--stores SLS,GS` to grant specific stores to non-admins. |
| `npm run import:ls-vendors -- --file export.csv [--dry]` | Imports the Lightspeed vendor export (enabled vendors only, WWD/Faire/NOT WWD tags become billing routes, duplicates flagged for review). Safe to re-run. |
| `npm run import:vendor-directory -- --file list.xlsx --source wwd_show_2026_08 --label "Worldwide show, Aug 2026" [--route worldwide] [--apply-routes] [--dry]` | Loads a reference list (e.g. the Worldwide show vendor list) into the vendor directory. Not vendors: used to recognise WWD/Faire vendors when new ones arrive, and to tag matching vendors that have no route yet. Safe to re-run. |
| `npm run import:show-lists -- --show wwd_fall_2026 --label "Fall 2026 (Reno, Sept 1-3)" --date 2026-09-01 --exhibitors ExhibitorListing.pdf --lines ShowTime.pdf --lines-pages 6-9 [--new-pages 18] [--dry]` | Loads a Worldwide show from its two PDFs: lines and attendance (booth, exhibitor), links matching vendors, adds WWD to vendors with no route. Needs `pdftotext`. Safe to re-run. |
| `npm run import:rep-lines -- --file lines.xlsx --rep-group "Name" --contact "Rep" --email x --phone y --route worldwide\|direct\|faire\|none --source rep_x [--specials-label "Fall 2026"] [--match-hints "Line=VMS vendor"] [--dry]` | Loads a rep's line list: rep group with contact, vendors linked (rep group, route if none, zero upcharge, do-not-order from notes, catalog and specials links), the rest as catalog-only lines. |
| `npm run propose:renames -- [--dry]` | Proposes clean-ups for Lightspeed names carrying a rep or parent-company tag, as review items for approval. |
| `npm run import:wwd-roster -- --file roster.pdf --member 816 --main-phone 253-872-8746 [--dry]` | Loads Worldwide's team roster: member number, main line, every person, and marks the AR specialist for our member range, the vendor liaisons and the warehouse for the vendor-page box. |
| `npm run import:order-guide -- --file guide.xlsx [--match-hints "Sheet name=VMS vendor;…"] [--dry]` | Loads the Placed Order Summary / Summer WWD Order Guide workbook: orders upserted by a stable key (safe to re-run on the living sheet), vendors linked or created, categories, report owners, do-not-order flags, inferred show tags. |
| `npm run analyze:ls-categories -- --items items.xlsx --categories categories.xlsx [--min 5] [--json report.json]` | Reads a Lightspeed item export plus category export and reports where size / gender-age breakdowns are missing, items sitting above an existing breakdown, mixed size naming, and item paths that are not real categories. Read-only. |
| `node scripts/deploy-functions.mjs gmail-sync [...]` | Deploys Supabase Edge Functions (each `supabase/functions/<name>/index.ts` plus `_shared/`) through the Management API. Run with `NODE_USE_ENV_PROXY=1` in a cloud session. |
| `node scripts/setup-mail-cron.mjs [--every "* * * * *"] [--run-now] [--no-schedule] [--off]` | Schedules `gmail-sync` with pg_cron. Generates the scheduler secret once, keeps it in Vault and as the function secret `MAIL_CRON_SECRET`; never prints it. `--run-now` starts one sync immediately. |
| `node scripts/create-test-login.mjs` | Creates or updates Claude's test login ("Claude (testing)", buyer) from `VMS_TEST_EMAIL` and `VMS_TEST_PASSWORD` in the cloud environment settings. Kept out of people pickers. Never prints the password. Run with `NODE_USE_ENV_PROXY=1`. |
| `node scripts/preview.mjs /vendors /mail [--out dir] [--viewport-only]` | Starts the app locally against live data, signs in as the test login and saves screenshots of each page at computer and phone size. Run with `NODE_USE_ENV_PROXY=1`. |

If the Management API token is not available, open the Supabase SQL Editor, paste the contents
of the migration file, and run it. The result is identical.

### Users and roles

Roles are `admin`, `manager`, `buyer`, `viewer`. A profile row is created automatically for every
auth user. **The first user created in an organization becomes its admin**; everyone after that
starts as `viewer` unless the user is created with `app_metadata.role` (which `db:create-user`
sets). Admins see every store in their organization; other roles see only the stores granted to them.

## Project layout

```
src/
  components/   ui (primitives), layout (shells), auth (route guards), shared, charts
  pages/        one folder per area (auth, vendors, orders, ...)
  context/      AuthContext
  hooks/        useAuth
  lib/          supabase client, constants, theme, utils
  services/     one module per domain, each a set of typed Supabase queries
  types/        database.ts (schema types), index.ts (app aliases)
supabase/
  migrations/   numbered SQL migrations
scripts/        operational scripts (migrations, user creation)
docs/           specifications
```

## Scripts

| Command | |
|---|---|
| `npm run dev` | Vite dev server |
| `npm run build` | Typecheck and production build |
| `npm run lint` | oxlint |
| `npm run test` | vitest unit tests |
| `npm run typecheck` | `tsc -b` |

## Deployment (Vercel)

The site is a static Vite build served by Vercel; `vercel.json` rewrites every path to
`index.html` so React Router handles routing. Required environment variables on Vercel:
`VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_APP_NAME`, `VITE_ORG_NAME`,
`VITE_APP_URL` (the public URL, used for password-reset links).

One-time setup, done by Dana (numbered steps are in the session notes), then the project
deploys automatically from the branch connected in Vercel. The custom domain
`vms.shaverlakesports.com` is a CNAME at GoDaddy pointing to Vercel.

## Build status

- [x] Phase 1 — scaffolding, foundation migration (organizations, stores, profiles, RLS), auth and login
- [x] Phase 2 — app shell, navigation, routing (no store selector, per docs/decisions.md); Vercel deployment pending token
- [~] Phase 3 — vendor database and Lightspeed vendor import done; vendor pages live; Gmail connection, enrichment and intake form next
- [ ] Phase 4 — dashboard, vendors, orders, automated vendor pipeline
- [ ] Phase 5 — purchase orders, returns, shipments, buying shows
- [ ] Phase 6 — reports, product sourcing, file manager, settings
- [ ] Phase 7 — integrations
