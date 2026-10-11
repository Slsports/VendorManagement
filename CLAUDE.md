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
- `docs/gmail-connection.md`, `docs/orders-and-mail-plan.md`, `docs/wwd-portal-import.md` — build plans
  for the mail views, orders (five sources, PO stamp, sending, confirmation check) and the WWD portal import.

## How Dana works with Claude
- Keep replies brief and plain; she is the shop owner, not a developer. No code in prose.
- Commit and push as you go on `claude/ecstatic-carson-ziz2a9`. Never create a PR unless asked.
- Secrets live in `.env` locally and in hosted environment variables, never in the repo or in chat.
- Say "Vendor ID" for the vendor's item number. Call Lightspeed "LS" is fine; Worldwide Distributors is
  "WWD". Nothing in Lightspeed changes until VMS is connected to it and each batch is approved.
- Only Dana is an admin. Trevor and Jarrett are managers. Do not promote anyone.
- Dana reviews proposals before data changes: duplicates, renames, category changes go through the
  review queue, never applied silently.
- **Wait for Dana's go-ahead.** When a task is being discussed, give a short overview and stop. Do not
  start building, editing files, changing data or pushing until Dana says to go ahead ("go", "do it",
  "yes, build it"). Questions and overviews are not a go-ahead.

## Screen rules (Dana, Oct 7)
- **Back goes to where you came from.** Every detail page (vendor, rep group, order, line, review item)
  has a Back link at the top that returns to the previous page in the app: the list with its filters, the
  vendor page that linked here, the review queue. Use one shared `BackLink` component that uses the
  in-app history when there is one and falls back to the section's list only on a cold open. Never link
  "All vendors" as the way out of a page reached from somewhere else.
- **Every list sorts by its headers.** Clicking a column header sorts by that column, clicking again
  reverses it, and the arrow shows the sort. One shared hook/component for all tables (orders, vendors,
  lines, rep groups, scores, mail). Default sort stays what it is today.
- **Save is always in reach.** Long edit forms end with the shared `StickySaveBar` (Save / Cancel pinned to
  the bottom of the screen, full-width on phones, shows "Saving…" and the error). Short forms and pop-up
  boxes keep their buttons where they are.

## Several sessions share one branch
Dana runs more than one Claude session at a time (a Fable session for big builds, an Opus session for
small fixes, a Sonnet session for questions). All code goes to `claude/ecstatic-carson-ziz2a9`.
- If your session started on another branch, switch first: `git fetch origin && git checkout claude/ecstatic-carson-ziz2a9`.
- **Before every push: `git pull origin claude/ecstatic-carson-ziz2a9`**, then lint, typecheck, test, then push.
  A conflict means the other session touched the same lines; resolve it, do not force-push.
- Hosted migrations are shared: run `NODE_USE_ENV_PROXY=1 npm run db:migrate` after pulling so your
  session's database view matches; it skips what is already applied.
- Append to `docs/decisions.md` for decisions, and to `CLAUDE.md` only for rules every session needs.

## Private mail (Oct 11)
Personal mailboxes and the old Gmail live in `mailboxes`; their threads/emails have `mailbox_id` set and are
private to the owner and the admin (RLS). Never copy their subjects, snippets or senders into org-wide tables
(review_items, notes, logs); Orders lists filter `mailbox_id is null or shared_at is not null`. Gmail calls use the
email's `gmail_box`, never the org's single mailbox.

## Stack and commands
Vite + React 19 + TypeScript + Tailwind 4, Supabase (project `bpdpkytfmpbwpbmpejbf`), vitest, oxlint.
- `npm run lint`, `npm run typecheck`, `npm test` — run all three before every push.
- `npm run db:test` — applies every migration plus `supabase/tests/*.test.sql` to local Postgres 16
  (`pg_ctlcluster 16 main start` first). Add a `.test.sql` for every migration.
- `NODE_USE_ENV_PROXY=1 npm run db:migrate` — applies pending migrations to the hosted project through
  the Supabase Management API (the cloud proxy injects the token; it throttles, `scripts/db.mjs` retries).
- `NODE_USE_ENV_PROXY=1 node scripts/deploy-functions.mjs <name>` — deploys an Edge Function (with
  `supabase/functions/_shared`). Functions see the publishable key, not yours: test them through pg_net
  with the Vault secret (see `scripts/setup-mail-cron.mjs --run-now`), never by printing secrets.
- Ad-hoc hosted SQL: write a scratch `.mjs` that imports `query` from `scripts/db.mjs` and run it with
  `NODE_USE_ENV_PROXY=1`. The proxy does **not** carry the service-role key, so `db:create-user` and
  storage uploads do not work from a cloud session; auth users were created with SQL into `auth.users`.
- Every migration grants explicitly (hosted default privileges give nothing) and adds RLS policies.
  Helpers: `user_in_org`, `user_can_edit` (admin/manager/buyer), `is_admin`.
- Looking at screens: `NODE_USE_ENV_PROXY=1 node scripts/preview.mjs /vendors/<id>/edit` signs in as the test
  login "Claude (testing)" (buyer; `VMS_TEST_EMAIL`/`VMS_TEST_PASSWORD` in the environment settings, created by
  `scripts/create-test-login.mjs`) and screenshots at computer and phone size. Never print the password.
- A new foreign key between two tables that already had one makes `table(*)` embeds ambiguous (PGRST201,
  the page shows "more than one relationship"). After such a migration run
  `NODE_USE_ENV_PROXY=1 node scripts/check-embeds.mjs src supabase/functions` and name the key
  (`vendor_emails!vendor_emails_vendor_id_fkey(*)`).
- The cloud proxy drops user sign-in tokens to `*.supabase.co`, so `scripts/preview.mjs` and supabase-js calls as
  the test login fail ("permission denied", 401) from a cloud session. To run an app RPC as a user, use `query`
  with `select set_config('request.jwt.claims', '{"sub":"<profile id>","role":"authenticated"}', true); set local
  role authenticated; select …` (the "Claude (testing)" profile), never Dana's.
- Types are hand-maintained in `src/types/database.ts`; add Row/Insert/Update and function Returns for
  every schema change, then aliases in `src/types/index.ts`.

## What exists (October 2026)
Vendors (778, with routes WWD / Faire / direct, standing fine/hold/last resort/do-not-order with reason
tags, free-shipping policy and threshold, freight routing, fishing flag, WWD zero-upcharge), rep groups,
lines (catalog-only names, never vendors unless promoted), five show listings, Worldwide contacts,
orders (Seasonal Buying Guide plus the Placed Order Summary v2.0 tabs 1-4, `import:placed-orders`), WWD invoices and payments (Payments page WWD box: Payment History, EdenRed, Dana's payment sheets, scans), review
queue with assignment rules, vendor scorecards (six dimensions, four automatic), item-level buying
rules per vendor (seeded for Ty), Lightspeed category standard document, and Mail: orders@ synced every
minute (12 months back), sender proposals in the review queue, Mail page, send/reply/forward from orders@
with signatures, follow-up nudges (see `docs/gmail-connection.md` "As built").

## Not built yet, in order
Gmail label write-back and contact enrichment,
Needs list, Lightspeed API connection, category and item clean-up tool, replenishment check, pattern
engine, show-prep view. Target: running well by December 2026 for the WWD show Jan 25-28, 2027.
