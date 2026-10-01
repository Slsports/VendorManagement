# RetailHQ VMS — Automated Vendor Pipeline & Platform Spec

**Version:** 4  
**Date:** October 1, 2026  
**Owner:** Dana Powell, Shaver Lake Sports  
**Builder:** Claude Code, directed by Dana. There is no outside developer on this project.

**Companion documents in this folder:**
- `development-strategy.md` — Claude Code's 7-phase build plan (stack, schema, pages, phases). This spec adds to it and, where noted in §12, overrides it.
- `confirmation-comparison-claude-instructions.md` — the system prompt for the confirmation comparison feature (Claude API Call 2 in §8).
- `sales-report-formatting-spec.md` — the system prompt for sales report formatting (Claude API Call 1 in §8). **Dana will supply this from her Sales Report Formatting project.**

---

## 1. How to Read This Document

The Development Strategy describes the VMS as a whole: database schema, pages, auth, navigation, build phases. This document describes a set of features and architectural requirements that were decided after the strategy was written. Treat the two as one spec:

- Where this document adds something the strategy does not mention, build it as described here.
- Where this document and the strategy disagree, **this document wins**. Every such case is listed in §12 so nothing is silently contradicted.
- §13 maps every feature in this document to a phase in the strategy.

---

## 2. Business Context

**Company structure.** Shaver Lake Sports Inc. (SLSI) is the parent corporation. It operates four stores in the Shaver Lake, CA mountain resort area:

| Code | Store | Aliases to map on import |
|---|---|---|
| SLS | Shaver Lake Sports | — |
| SLH | Shaver Lake Hardware | — |
| SLM | Shaver Lake Marina | — |
| GS | The Happy Camper General Store | `HAPPY`, `HC` |

GS is the code used in QuickBooks. Existing spreadsheets sometimes use `HAPPY` or `HC` for the same store; the import step must map both to GS.

**Buyers.** Two people place vendor orders: **Dana Powell** (owner) and **Jarrett (JW)**. **TJ (Trevor)** runs the Lightspeed sales reports that support buying decisions but does not place orders. Any "assigned buyer" field or buyer dropdown should offer Dana and JW only.

**Buying cycle.** ~150–200 vendors. Two trade shows per year: February (winter goods) and August (spring/summer goods). Example vendors: World Famous Sports (WFS), Stansport, Slippery Racer, Planet Cotton. Rep groups include Dandylines, Arlene Oom & Co, and Sugar B Sales.

**Customer base.** Highly seasonal, impulse-driven, resort-oriented. This matters for the sales-report NEED calculations: a 365-day sales window is the norm.

**Orders mailbox.** Currently Outlook; **migrating to Gmail Workspace**. Migration is in progress and must be complete, with attachments intact, before the inbound email features in §10 go live.

---

## 3. Confirmed Stack

As set out in the Development Strategy and confirmed in this session:

| Layer | Technology |
|---|---|
| Frontend | React + Vite + TypeScript |
| Styling | Tailwind CSS |
| Backend, DB, auth, storage, RLS | Supabase (managed PostgreSQL) |
| Hosting | Vercel |
| Background workers (later, only if needed) | Railway — for long-running jobs such as mailbox backfill scans, if Supabase Edge Functions prove insufficient |
| AI | Anthropic Claude API |

Secrets live in a `.env` file locally and in environment variables in hosted environments. Never in the repo, never in chat.

---

## 4. The Automated Vendor Pipeline

The pipeline has three stages. Stages 1 and 2 run independently and connect through the vendor record. Stage 3 is triggered by Stage 2.

```
Lightspeed → Google Drive → Claude (format) → Vendor Record
                                                    ↓
Vendor confirmation email → match vendor → pull report → Claude (compare)
                                                    ↓
                                   Save to Order → Email Buyer (+ Dana)
```

### 4.1 Stage 1 — Sales Report Auto-Formatting

**Trigger:** An employee runs a vendor sales report in Lightspeed and saves it to the Google Drive folder `/RetailHQ/Vendor Reports/Incoming/`.

**Steps:**
1. Drive watcher detects the new file (webhook preferred; 30-minute polling as fallback — see §9).
2. Extract the vendor name from the filename using the rules in §9.3. Match to a vendor record by name or alias. If no match, move the file to `/Error/` and alert Dana.
3. Send the file to Claude (API Call 1) with the Sales Report Formatting Spec as the system prompt.
4. Claude returns the formatted report with NEED and ORDER logic applied.
5. Save the formatted report to the vendor record as a new row in `vendor_sales_reports`, timestamped, with the original filename and a version number.
6. Move the original file to `/RetailHQ/Vendor Reports/Processed/`.
7. Write an `activity_log` entry.

**Versioning rule.** The comparison in Stage 2 must use the report version that was in effect when the order was placed, not the newest one. Store every version; never overwrite. Stage 2 selects the most recent report whose `created_at` is **before** the order's confirmation date.

### 4.2 Stage 2 — Confirmation Auto-Comparison

**Trigger:** An order confirmation email arrives in the orders mailbox from a known vendor.

**Steps:**
1. Gmail monitor (§10.1) sees the new message. Claude (API Call 3) classifies it as an order confirmation and extracts: vendor name, order number, order date, receive-by date, order total, and the attachment.
2. Match the sender address and extracted vendor name to a vendor record (name, aliases, `vendor_emails`). If no match, place the email in the review queue and alert Dana.
3. Find or create the `orders` row for this order number. Attach the confirmation to the order's files with `invoice_type = order_confirmation`.
4. Select the correct `vendor_sales_reports` row per the versioning rule in §4.1.
5. Send the confirmation and the sales report to Claude (API Call 2) with `confirmation-comparison-claude-instructions.md` as the system prompt.
6. Claude returns the 5-tab comparison workbook (Summary, Comparison, Missing, New Items, Substitution Analysis) as described in that document.
7. Save the workbook to the order's files with `invoice_type = comparison_report`.
8. Append every line item's unit cost to `vendor_sku_cost_history` (§7.3).
9. Write an `activity_log` entry and set `orders.has_comparison = true`.

**If no sales report exists for the vendor yet:** do not block. Attach the confirmation to the order, flag the order with a "No sales report on file" badge, and alert Dana. When a report is later processed for that vendor, offer a "Run comparison now" action on the order.

**If the newest report is dated after the confirmation:** use the most recent report dated before the confirmation if one exists. If none exists, run the comparison with the newer report but flag the result: "Comparison used a sales report dated after the order — NEED numbers may differ from what the buyer saw."

### 4.3 Stage 3 — Buyer Notification

After Stage 2 completes:

1. Look up `vendors.assigned_buyer_id` → the buyer's profile email.
2. Send an email (§10.2) to the buyer with Dana always CC'd (if Dana is the buyer, send once).
3. Email contains: vendor name, order number, counts (covered / missing / new / qty shortfall), total dollar value of new items, any price increases flagged, and the comparison workbook attached.
4. Create an in-app `notifications` row for the buyer and for Dana.

### 4.4 Manual Fallback

Every automated step must also be runnable by hand from the UI: upload a sales report to a vendor, upload a confirmation to an order, "Run comparison now," "Resend to buyer." Automation is the default path, not the only path.

---

## 5. Email-Based Vendor Enrichment

Vendor contact data currently lives in a mix of spreadsheets. Dana is preparing a vendor contact spreadsheet for import once the app is ready to test (§14). After that import, the orders mailbox is the richest source for filling gaps and keeping records current.

**Sequencing.** Import Dana's spreadsheet first so there is a clean vendor list to match against. Then run the enrichment backfill. Claude Code recommended pulling this forward to immediately after the vendor import (Phase 3) rather than waiting for Phase 7; this spec adopts that recommendation.

**Backfill scan.** With Gmail API read access (§10.1), walk back through 2–3 years of mail. Match each sender to a vendor by domain and name. Extract from three places:
- **Signatures:** names, titles, direct phones, cells, websites.
- **Headers and CC lines:** who the rep, the AP contact, and the customer service contact are, based on who replies to what.
- **Attachments:** invoices give remit-to addresses, account numbers, payment terms, AP emails. Confirmations give rep names and phones.

**Review queue, not auto-write.** Claude returns each extracted field with a confidence score. Nothing is written to a vendor record automatically at first. Each suggestion appears in a review queue: "Found AP contact for Ace USA in invoice dated 5/5/26 — Accept / Reject." Once Dana trusts the results, a per-tenant setting enables auto-accept above a confidence threshold.

**Ongoing monitoring.** New mail is scanned as it arrives. Changes (new rep, changed remittance address) are flagged the same way.

**What it will not find.** Star ratings, category assignments, minimum order rules that were never put in writing. The spreadsheet remains the authoritative starting point.

**Outlook history.** The scan can only read what is in Gmail. The Outlook mailbox must be migrated into the Gmail account (Google's migration tool) with attachments preserved, or a one-time Outlook export must be processed separately. Verify a sample of migrated messages still carry their PDFs before relying on the scan.

---

## 6. AI-Drafted Return & Claim Emails

The Development Strategy (Phase 4) generates return emails from static templates configured in Settings. This spec replaces that with a learned approach; templates become the fallback.

**Why.** Dana's sent mail is the real record of how returns are handled: which vendors require an RA number before anything ships, who needs photos, claim deadlines learned the hard way (e.g. WFS requires claims within 30 days of delivery), and the tone used with each vendor. A static template discards all of that.

**How it works:**

1. **Learn during the enrichment backfill (§5).** While scanning sent mail, Claude also extracts return/claim patterns per vendor: how Dana opens, what information she always includes, vendor-specific requirements, tone, and any deadlines mentioned.
2. **Store as `vendors.return_notes`.** Plain text on the vendor record, visible and editable by Dana so anything the AI inferred wrongly can be corrected. These notes are a durable asset even if the AI drafting is turned off.
3. **Draft on demand.** When a return is generated from a check-in discrepancy (strategy Phase 4), Claude (API Call 4) drafts the email using: Dana's general voice (from the backfill), that vendor's `return_notes`, and the specific discrepancy details, quantities, and photos.
4. **Review before send — unchanged.** The draft opens in the editable preview exactly as the strategy already specifies. Nothing sends without a human clicking Send.
5. **Fallback.** For a vendor with no history, use a base template written in Dana's voice. Templates stay in Settings for this purpose.

**Guardrails.** Do not infer "rules" from a single email. Require a pattern across multiple messages before writing it to `return_notes`, and mark the source emails so Dana can check. One-off situations and vendors Dana no longer uses should not shape the defaults.

---

## 7. Vendor Record — Additional Fields & Tables

The strategy's `vendors` table has: name, contacts, rep group, payment terms, rating, tier, `is_active`. The following must be added. "Source" shows where the requirement came from.

### 7.1 New columns on `vendors`

| Field | Type | Source | Notes |
|---|---|---|---|
| `aliases` | text[] | Pipeline | Alternate names and abbreviations, e.g. `{"WFS"}` for World Famous Sports. Used for filename and email matching. |
| `assigned_buyer_id` | uuid → profiles | Pipeline | Dana or JW. Routes Stage 3 notifications. Buyer email is read from the profile, not stored separately. |
| `google_drive_folder` | text | Pipeline | Optional per-vendor subfolder if different from the default `/Incoming/`. |
| `return_notes` | text | §6 | AI-learned return/claim patterns; editable. |
| `rep_name` | text | Placed Order Summary v2.0 | The individual rep for this vendor. May differ from the rep group's main contact. |
| `rep_phone` | text | Placed Order Summary v2.0 | |
| `pickup_address` | text | Placed Order Summary v2.0 | Vendor pick-up address, for will-call orders. |
| `pickup_times` | text | Placed Order Summary v2.0 | Free text (e.g. "M–F 8–4"). |
| `shipping_contact` | text | Placed Order Summary v2.0 | |
| `shipping_contact_phone` | text | Placed Order Summary v2.0 | |

The `Rep Group` column from the Placed Order Summary maps to the existing `rep_groups` relation.

### 7.2 New table: `vendor_emails`

One vendor, many sender addresses. Used to match inbound mail.

| Column | Type | Notes |
|---|---|---|
| `id` | uuid | |
| `vendor_id` | uuid → vendors | |
| `email` | text | Unique per tenant |
| `contact_type` | enum | `rep`, `ap`, `customer_service`, `shipping`, `orders`, `other` |
| `contact_name` | text | |
| `source` | enum | `import`, `manual`, `email_enrichment` |
| `confidence` | numeric | From enrichment; null if manual/import |
| `verified_at` | timestamptz | Set when Dana accepts an enrichment suggestion |

### 7.3 New table: `vendor_sales_reports`

| Column | Type | Notes |
|---|---|---|
| `id` | uuid | |
| `vendor_id` | uuid → vendors | |
| `store_id` | uuid → stores | Which store's sales the report covers |
| `original_filename` | text | |
| `file_id` | uuid → files | The formatted output |
| `source_file_id` | uuid → files | The raw Lightspeed export |
| `version` | int | Increments per vendor |
| `report_period_days` | int | Usually 365 |
| `created_at` | timestamptz | Used by the versioning rule in §4.1 |
| `processed_by` | enum | `pipeline`, `manual` |

### 7.4 New table: `vendor_sku_cost_history`

Appended every time a confirmation is processed. Enables cost trend reporting across buying cycles.

| Column | Type | Notes |
|---|---|---|
| `id` | uuid | |
| `vendor_id` | uuid → vendors | |
| `vendor_sku` | text | As it appears on the confirmation |
| `description` | text | |
| `unit_cost` | numeric | |
| `order_id` | uuid → orders | |
| `recorded_at` | timestamptz | Order confirmation date |

### 7.5 Additions to existing tables

- `orders`: add `has_comparison` boolean, `comparison_flag` text (nullable; holds warnings such as "No sales report on file").
- `files.invoice_type`: extend the enum to include `order_confirmation` and `comparison_report` alongside the strategy's `vendor_invoice`.
- `profiles`: no change; buyer email comes from the existing auth user.

---

## 8. Claude API Integration Points

All calls use the Anthropic Messages API. **A new API key is required for this project — obtain from Dana.** The API key already in use at SLS belongs to a separate private accounting-email automation and must not be reused here.

System prompts (the two spec documents) are stored in the database per tenant, not hardcoded, so Dana can update them in Settings without a deploy.

| Call | Purpose | Input | Output | Trigger |
|---|---|---|---|---|
| 1 | Sales report formatting | Raw `.xlsx` + `sales-report-formatting-spec.md` | Formatted report (Excel) | New file in Drive `/Incoming/` |
| 2 | Confirmation comparison | Confirmation (`.pdf`/`.xlsx`) + formatted report + `confirmation-comparison-claude-instructions.md` | 5-tab Excel workbook | Confirmation matched to vendor |
| 3 | Email classification & enrichment | Email body, headers, attachments | Classification (confirmation / invoice / price list / catalog / other), extracted fields with confidence | New mail in orders mailbox; backfill scan |
| 4 | Return email drafting | Discrepancy details, photos, `vendors.return_notes`, voice profile | Email subject + body draft | "Email to Vendor" on a return |

**Model:** use the current recommended Sonnet-class model at build time; make it a config value.

**Reliability:** 3 retries with backoff; 90-second timeout; on final failure write an `activity_log` error and alert Dana. Never fail silently.

**Files:** send PDFs and Excel files base64-encoded. Confirmations may be either format.

**Cost tracking:** log tokens per call with `tenant_id` so usage can be attributed and, later, billed.

---

## 9. Google Drive Integration

### 9.1 Folder structure

```
/RetailHQ/Vendor Reports/Incoming/     ← employees drop Lightspeed exports here
/RetailHQ/Vendor Reports/Processed/    ← moved here on success
/RetailHQ/Vendor Reports/Error/        ← moved here on failure, with a .txt note explaining why
```

### 9.2 Detection

- **Preferred:** Google Drive push notification (webhook) to a Supabase Edge Function. Immediate.
- **Fallback:** poll every 30 minutes via pg_cron if the webhook cannot be kept alive.
- OAuth 2.0 with Drive read/write scope under the SLS Google Workspace account. Per-tenant credentials (§11).

### 9.3 Vendor name from filename

Same rules as the Confirmation Comparison instructions, Step 2:

1. Strip dates (`8-27-26`), version tags (`v5`), buyer initials (`TJ`, `JW`, `Dana`), underscores, and generic words (`SALES`, `REPORT`, `DAYS`, `365`).
2. Convert to title case.
3. Match against `vendors.name` and `vendors.aliases`, case-insensitive, punctuation stripped.
4. No match → `/Error/` + alert.

Examples:

| Filename | Vendor |
|---|---|
| `TJ_8-27-26_WORLD_FAMOUS_SPORTS_SALES_365_DAYS_v5.xlsx` | World Famous Sports |
| `TJ_8-27-26_STANSPORT_SALES_365_DAYS_v3.xlsx` | Stansport |
| `JW_8-27-26_SLIPPERY_RACER_SALES_v2.xlsx` | Slippery Racer |
| `Dana_8-27-26_PLANET_COTTON_SALES_v1.xlsx` | Planet Cotton |

---

## 10. Email Integration

### 10.1 Inbound — Gmail API read access (supersedes forwarding)

The Development Strategy (Phase 7) proposed forwarding vendor mail to a system address parsed by Resend/SendGrid. Because the orders mailbox is Gmail Workspace, **use the Gmail API with read access instead.** It allows the historical backfill in §5 (forwarding cannot see old mail) and requires no change to how vendors send email.

- Grant read scope to the orders mailbox only, via Workspace admin. Do not touch personal mailboxes.
- Gmail push notifications (Pub/Sub) preferred; polling as fallback.
- Every message runs through Claude Call 3 for classification. Attachments are filed to vendor sub-folders (Invoices, Order Confirmations, Price Lists, Catalogs, General) as the strategy describes; low-confidence results go to the review queue.
- Order confirmations additionally trigger Stage 2 (§4.2).

### 10.2 Outbound

- Buyer notifications (§4.3), return emails (§6), POs (strategy Phase 5).
- Send via Gmail API from the orders mailbox so replies land in the same thread history, or via Resend/SendGrid if sending limits require it. Make this a config choice.
- **Dana is always CC'd** on buyer notifications and return emails.
- Sender name and footer branding come from tenant settings (§11.4).

---

## 11. Platform, Access & Multi-Tenant Architecture

### 11.1 Access & devices

- Responsive web application. No native mobile app.
- Fully usable on desktop/laptop, iPad, and phone. Tables, forms, and the check-in flow must work on a phone screen in a stockroom.
- **Initial URL:** `vms.shaverlakesports.com` (domain already hosted at GoDaddy; a DNS record pointing the subdomain to Vercel is required).
- **Future URL:** `app.retailhq.ai` or similar when the product goes to market (§11.5).
- Login: email + password, plus Google SSO for Workspace users.

### 11.2 Tenant layer above stores

The strategy scopes everything to **stores**. For the SaaS future (§11.5), there must be an **organization (tenant)** layer above stores, built in from the first migration:

- New table `organizations` (tenant): id, name, slug, branding fields (§11.4), settings JSON, `created_at`.
- Every store belongs to one organization. Every tenant-owned row (vendors, orders, files, reports, cost history, notifications, system prompts, integrations) carries `organization_id` directly or resolves to it through its store.
- RLS: first check `organization_id` matches the user's organization; then apply the strategy's store-access check. Helper: `user_in_org(org_id)`.
- Storage buckets are partitioned by `organization_id/…` in the object path.
- Google and Gmail OAuth tokens, the Anthropic key, and system prompts are stored **per organization**.
- SLSI is organization #1 with its four stores. The code must never assume a single tenant.

### 11.3 Roles

Use the strategy's roles — **admin, manager, buyer, viewer** — not the Admin/Buyer/Staff wording used in earlier drafts of this spec.

- Dana: admin. JW: buyer. TJ: role to be assigned by Dana in Settings (needs permission to upload sales reports; whether he sees cost data is an open item in §15).
- Buyer dropdowns list users with the `buyer` role (plus admins).

### 11.4 White labeling per tenant

Each organization can upload its own logo and set a name and accent color in Settings. These appear in the app header/sidebar, in system-sent emails, and on generated reports (comparison workbook title rows, PO PDFs). The strategy's "Shaver Lake Sports brand palette" and "SLS logo in sidebar" become the **defaults for organization #1**, not hardcoded values. Keep all branding in a theme config driven by the tenant record.

### 11.5 Future SaaS consideration

This application is initially being built for internal use at Shaver Lake Sports, accessible at `vms.shaverlakesports.com`. However, after the platform is used and refined in a live retail environment, there is a strong possibility it will be rebranded and launched as a public, for-profit SaaS product under the domain `retailhq.ai`. With that in mind:

- Build the architecture to be multi-tenant from day one (§11.2) so no rebuild is required at launch.
- Avoid hardcoding `shaverlakesports.com` anywhere — use environment variables for all domain references, email sender addresses, OAuth redirect URIs, and branding assets so rebranding requires a config change, not a code change.
- Keep branding elements (logo, app name, color scheme) in a central config or theme file so the switch from Shaver Lake Sports to RetailHQ.ai is a single update.
- Build per-tenant white labeling into tenant settings from the start (§11.4) — each customer uploads their own logo and it appears in the app header, system emails, and generated reports, replacing RetailHQ.ai branding for their employees.
- Design the database and file storage structure to support unlimited tenants, not just one.
- OAuth credentials (Google Drive, Gmail) will need to be re-registered under the RetailHQ.ai domain when the rebrand occurs — plan for this in the auth setup.

---

## 12. Changes to the Development Strategy

This section is the authoritative list of places where this spec overrides `development-strategy.md`.

| Strategy says | This spec says | Where |
|---|---|---|
| Return emails are generated from static templates in Settings | AI-drafted from Dana's sent-mail history + `vendors.return_notes`; templates are the fallback. Review-before-send is unchanged. | §6 |
| Inbound vendor email via forwarding to a system address parsed by Resend/SendGrid | Gmail API read access on the orders mailbox (enables backfill; no forwarding needed) | §10.1 |
| Stores are the top-level scope for RLS | Organizations (tenants) are the top level; stores sit beneath | §11.2 |
| Tailwind configured with the Shaver Lake Sports palette; SLS logo in the sidebar | Those are the defaults for organization #1; all branding is tenant-driven | §11.4 |
| `vendors` table: name, contacts, rep group, terms, rating, tier | Add the columns and tables in §7 | §7 |
| `files.invoice_type`: `vendor_invoice` or null | Also `order_confirmation`, `comparison_report` | §7.5 |
| Email enrichment / attachment filing in Phase 7 | Email enrichment pulled forward to immediately after the vendor import (Phase 3); attachment filing stays in Phase 7 | §13 |
| Earlier draft of this spec used roles Admin / Buyer / Staff | Use the strategy's admin / manager / buyer / viewer | §11.3 |
| Stores: "General Store" | Full name: The Happy Camper General Store; code GS; aliases HAPPY, HC | §2 |

---

## 13. Where These Features Fit in the Build Phases

| Feature | Strategy phase | Notes |
|---|---|---|
| `organizations` table and tenant-scoped RLS | **Phase 1C/1D** | Must be in the first migration. Cannot be added later without a rebuild. |
| Vendor columns and tables in §7 | Phase 1C | Add to the initial schema. |
| Tenant branding config, theme file | Phase 1A / Phase 2 | Replace hardcoded palette with tenant-driven theme. |
| Vendor contact spreadsheet import (with HAPPY/HC → GS mapping) | Phase 3 | Dana supplies the spreadsheet (§14). |
| Email-based vendor enrichment + review queue | **Phase 3 (right after import)** | Pulled forward from Phase 7. Requires Gmail read access, so Gmail OAuth setup also moves to Phase 3. |
| Stage 1 — sales report auto-formatting | Phase 4 (alongside Vendors) | Needs Drive OAuth, Claude Call 1, `vendor_sales_reports`. |
| Stage 2 — confirmation comparison | Phase 4 (alongside Orders) | Needs Gmail classification (Call 3), Claude Call 2, `vendor_sku_cost_history`. |
| Stage 3 — buyer notification | Phase 4 | Needs outbound email. |
| AI-drafted return emails | Phase 4 (Returns) | Depends on enrichment backfill having run. |
| Vendor attachment auto-filing to sub-folders | Phase 7 | As the strategy describes, but on the Gmail API path. |
| Cost trend report (from `vendor_sku_cost_history`) | Phase 6 (Reports) | New report template: cost change by vendor and SKU across buying cycles. |
| White-label settings UI | Phase 6 (Settings) | Logo upload, name, accent color. |

---

## 14. Dependencies Dana Supplies

| Item | Needed by | Status |
|---|---|---|
| `sales-report-formatting-spec.md` — from the Sales Report Formatting Claude project, converted to markdown and placed in `docs/` | Phase 4, Stage 1 | Not yet in repo |
| Vendor contact spreadsheet (authoritative vendor list with contacts) | Phase 3 import | In progress |
| New Anthropic API key for this project | Phase 4 | Not yet created |
| Gmail Workspace migration complete, Outlook history imported with attachments | Phase 3 enrichment | In progress |
| Supabase project, Vercel account, GitHub connection | Phase 1 | Claude Code will give numbered steps |
| GoDaddy DNS record for `vms.shaverlakesports.com` → Vercel | Phase 2 | Not yet done |
| Google Cloud project with Drive and Gmail APIs enabled, OAuth consent configured | Phase 3/4 | Not yet done |

---

## 15. Open Items

Decisions still needed from Dana. None block Phase 1–2.

1. **TJ's role and visibility.** Can TJ (and `viewer`-role staff generally) see unit cost data, or only quantities?
2. **File retention.** Keep every sales report and comparison workbook forever, or archive after N buying cycles?
3. **Lightspeed export consistency.** Does every vendor sales report export with the same columns? If report types vary, Call 1's parser needs samples of each.
4. **Alerting channel.** Spec proposes both email and in-app notification for pipeline errors. Confirm, or pick one.
5. **Enrichment auto-accept threshold.** Spec proposes manual review for everything until Dana opts in to auto-accept. Confirm the threshold later, after seeing results.
6. **Comparison workbook storage.** Spec stores it as an Excel file on the order. Should the Missing / New Items / cost-change rows also be written to tables so they can be reported on across orders? Recommended yes, as a Phase 6 addition.

---

*Last updated: October 1, 2026 3:18 PM PDT*
