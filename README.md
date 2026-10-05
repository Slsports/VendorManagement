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
- [ ] Phase 3 — data layer, spreadsheet import, email-based vendor enrichment
- [ ] Phase 4 — dashboard, vendors, orders, automated vendor pipeline
- [ ] Phase 5 — purchase orders, returns, shipments, buying shows
- [ ] Phase 6 — reports, product sourcing, file manager, settings
- [ ] Phase 7 — integrations
