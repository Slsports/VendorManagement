# Development Strategy: Shaver Lake Sports Vendor Management System (Production)

## Context

Dana (owner of Shaver Lake Sports, Shaver Lake Hardware, Shaver Lake Marina, and General Store) wants to build a **real production vendor management system** — not just a prototype. Her data currently lives in a mix of Google Sheets and Excel files. She has no technical staff, so the system needs to be simple to host and maintain. All features (order tracking, vendor management, dashboard, reports) are equally important.

## Recommended Stack

| Layer | Technology | Why |
|-------|-----------|-----|
| **Frontend** | React + Vite + TypeScript | Fast, modern, great ecosystem |
| **Styling** | Tailwind CSS | Rapid UI development, responsive built-in |
| **Backend + DB** | **Supabase** (managed PostgreSQL) | No servers to manage, built-in auth, file storage, real-time — perfect for a team without a developer |
| **Hosting** | Vercel (frontend) | Free tier works, auto-deploys from Git |
| **Icons** | Lucide React | Clean, consistent |
| **Charts** | Recharts | Composable, React-native |
| **Tables** | @tanstack/react-table | Sorting, filtering, pagination built-in |
| **Dates** | date-fns | Lightweight date formatting |
| **Toasts** | react-hot-toast | Simple notification toasts |

## Development Phases

### Phase 1: Foundation (Scaffolding + Database + Auth)

**1A. Project Setup**
- Initialize Vite + React + TypeScript project
- Install all dependencies
- Configure Tailwind with Shaver Lake Sports brand palette (earthy tones, forest greens, warm browns)
- Set up file structure:

```
src/
  components/
    ui/           # Button, Input, Modal, Badge, Select, etc.
    layout/       # AppShell, Sidebar, Topbar, MobileNav
    shared/       # DataTable, StatusBadge, StarRating, FileUploader, MetricCard
    charts/       # Recharts wrappers
  pages/
    auth/         # Login, ResetPassword
    vendors/      # VendorList, VendorDetail, VendorForm
    orders/       # OrderList, OrderDetail, OrderForm
    purchase-orders/
    returns/
    shipments/
    buying-shows/
    reports/
    product-sourcing/
    file-manager/
    settings/
  lib/
    supabase.ts   # Typed Supabase client singleton
    constants.ts  # Enums, store codes, status values
    utils.ts      # Formatters, helpers
  services/       # One file per domain (vendors.ts, orders.ts, etc.)
  hooks/          # useAuth, useStore, useRealtimeSubscription, useSupabaseQuery
  context/        # AuthContext, StoreContext
  types/          # database.ts (auto-generated), index.ts
supabase/
  migrations/     # SQL migration files (numbered)
  seed.sql        # Initial stores, categories, admin user
scripts/
  import-spreadsheet.ts  # One-time data import from Excel/Sheets
```

**1B. Supabase Project Setup**
- Create Supabase project
- Enable email/password auth
- Create storage buckets: `vendor-documents`, `purchase-orders`, `general-files`
- Enable realtime on key tables (orders, notifications)

**1C. Database Schema** (SQL migrations applied in order)

Core tables:
- **`stores`** — SLS, SLH, SLM, GS with name, code, address, phone
- **`profiles`** — extends Supabase auth.users with full_name, role (admin/manager/buyer/viewer), avatar
- **`user_store_access`** — junction table: which users can access which stores
- **`categories`** — Fishing, Camping, Hardware, Marine, etc.
- **`rep_groups`** — Dandylines, Arlene Oom & Co, Sugar B Sales, etc. with contact info
- **`vendors`** — name, contacts, rep group, payment terms, rating, tier, soft-delete via is_active
- **`vendor_stores`** — many-to-many: vendors serve multiple stores
- **`vendor_categories`** — many-to-many: vendors in multiple categories
- **`orders`** — full lifecycle tracking with status enum: `open → awaiting_confirmation → confirmed → shipped → received → entered → ready_to_pay → paid → cancelled`
- **`order_items`** — line items with qty, unit_cost, generated total_cost column
- **`order_status_history`** — tracks every status transition with who/when/why
- **`purchase_orders`** — PO creation/tracking with status, linked to buying shows
- **`purchase_order_items`** — PO line items
- **`returns_credits`** — returns, credits, defectives, warranties with RMA tracking
- **`return_items`** — line items for returns
- **`order_checkins`** — digital check-in records: order_id, checked_in_by (employee), checked_in_at, overall_notes, has_discrepancies flag
- **`order_checkin_items`** — per-line-item check-in data: checkin_id, order_item_id, received_quantity, status (ok/short/overage/damaged/missing), notes (large text for damage descriptions)
- **`files`** — document metadata (polymorphic: links to vendor/order/PO/return/checkin_item via entity_type + entity_id). Includes `invoice_type` field for order files: `vendor_invoice` (final invoice from vendor) or `null` for general attachments. Damage photos attach to individual checkin_items
- **`buying_shows`** — show planning with budget tracking
- **`buying_show_vendors`** — vendors to visit, booth numbers, priority
- **`buying_show_checklist`** — prep tasks with assignments
- **`activity_log`** — audit trail for all entities
- **`notes`** — user notes on any entity
- **`notifications`** — per-user notifications with type and read status

Key design decisions:
- UUIDs for all primary keys
- Soft deletes (is_active flags) everywhere — never lose data
- Generated columns for line item totals (quantity × unit_cost)
- Row Level Security (RLS) on all tables — users only see data for stores they have access to
- Indexes on frequently queried columns (store_id + status, vendor_id, entity_type + entity_id)

**1D. Row Level Security**
- Helper functions: `user_has_store_access(store_id)` and `is_admin()`
- Every store-scoped table (orders, POs, returns, files) gets SELECT/INSERT/UPDATE policies checking store access
- Vendors use a join through `vendor_stores` to check access
- Profiles and notifications scoped to own user (admins see all profiles)

**1E. Auth Context**
- `AuthProvider` wraps the app, calls `supabase.auth.getSession()` on mount
- Listens to `onAuthStateChange` for session updates
- Fetches user profile + store access on login
- `useAuth()` hook exposes: user, profile, role, signIn, signOut, isLoading
- `<RequireAuth>` wrapper redirects unauthenticated users to /login

### Phase 2: Core Layout (Shell + Navigation + Routing)

**AppShell** — responsive layout:
- **Desktop (lg+)**: Fixed 256px dark sidebar + topbar + scrollable content
- **Tablet (md)**: Collapsible sidebar (64px icons, expands on hover)
- **Mobile (sm)**: No sidebar, hamburger opens slide-over drawer

**Sidebar** — dark themed with SLS logo, grouped navigation:
1. Overview: Dashboard
2. Procurement: Vendors, Orders (with sub-items by status), Purchase Orders
3. Operations: Returns & Credits, Incoming Shipments, Buying Shows
4. Insights: Reports, Product Sourcing
5. System: File Manager, Settings

**Topbar**: Store selector dropdown (SLS, SLH, SLM, GS, or "All Stores"), global search bar, notification bell (real-time badge), user avatar/menu

**Routing** (React Router v6): All routes as defined in master prompt — /vendors, /orders, /purchase-orders, /returns, /shipments, /buying-shows, /reports, /product-sourcing, /files, /settings

**StoreContext**: Tracks active store selection, persists to localStorage, passes filter to all service calls

### Phase 3: Data Layer + Spreadsheet Import

**Service modules** (`src/services/`): One file per domain, each exporting async functions that query Supabase with proper joins, filters, and typing. Pattern:
```
getVendors(storeId?) → vendors with categories, rep groups, stores
getVendor(id) → single vendor with all relations
createVendor(data) → insert + create activity log entry
updateVendor(id, data) → update + log
```

**Custom hooks**:
- `useSupabaseQuery(queryFn, deps)` — returns { data, error, isLoading, refetch }
- `useRealtimeSubscription(table, filter, callback)` — live updates via Supabase channels

**Spreadsheet import script** (`scripts/import-spreadsheet.ts`):
- Reads Dana's .xlsx/.csv files using the `xlsx` library
- Column mapping configs per sheet (Open Orders, Paid Orders, etc.)
- Resolves vendor names (fuzzy matching for duplicates like "BECKER" / "BECKER GLOVES")
- Inserts via Supabase service role key (bypasses RLS)
- Run once during initial setup

### Phase 4: Core Pages — Dashboard, Vendors, Orders

**Dashboard**: KPI cards (open orders, awaiting payment, pending returns, MTD spend), order pipeline chart, recent activity feed, spending by vendor bar chart, upcoming arrivals, alerts. Real-time updates via Supabase subscriptions.

**Vendors**: Sortable/filterable data table with @tanstack/react-table. Card view option. Detail page with tabs (Overview, Orders, POs, Returns, Files, Notes). Full CRUD forms.

**Orders**: Data table with status-based tab filtering (All | Open | Awaiting Confirmation | ... | Paid | Cancelled). **Date range picker** for filtering incoming orders by expected arrival date range — select a start and end date to see all orders expected in that window (e.g., "what's arriving this week" or "what's coming in March"). Also filterable by vendor, store, and order date range.

**Search results show line items inline** — when you search/filter orders, the results table expands to show what items are in each order (SKU, description, quantity, cost) so you can see at a glance what's coming without opening each order. Each order row in the search results also has a **"View Confirmation" link** that opens the attached order confirmation document (PDF/image uploaded to the order's files). This lets you quickly pull up the vendor's confirmation for any open order directly from the search results.

Detail page with status timeline, line items, files, notes. Status advancement workflow. Full order creation form.

**Dual Invoice System**: Each order has two documents:

1. **Vendor Invoice** — the final invoice received from the vendor (uploaded PDF/image). The system extracts line items from the uploaded invoice (via OCR/AI parsing or manual entry) and populates the order's line items table.

2. **Digital Check-In Form** — instead of scanning handwritten notes, the system **auto-generates a check-in form** from the vendor invoice line items. When an employee clicks "Start Check-In" on an order:
   - Every line item from the vendor invoice appears as a row
   - Each row shows: SKU, description, expected quantity, unit cost
   - Next to each item, the employee gets:
     - **Received Qty** field (pre-filled with expected qty, editable)
     - **Status dropdown**: Received OK / Short / Overage / Damaged / Missing
     - **Notes field** (large text area — plenty of room to describe damage, condition, etc.)
     - **Photo upload** button — attach images of damaged items directly to that line item
   - At the bottom: overall notes field, signature/name of receiving employee, date/time auto-stamped
   - **Save as Draft** — the check-in form can be saved at any point mid-process and resumed later. The form has three states:
     - `in_progress` — partially filled out, employee can come back and continue
     - `complete` — all items checked, ready for review
     - `submitted` — finalized and locked
   - Workflow: Employee starts check-in → saves draft → comes back later → adds more notes/photos → saves again → reviews everything → hits "Submit" to finalize
   - Photos can be added at any time before submission — save the form, go take pictures of damage, reopen, attach photos to the relevant line items, save again
   - Only "Submit" triggers the discrepancy comparison and return generation — saving as draft does not
   - On submit: the system compares received vs. expected quantities, auto-flags discrepancies, and **auto-generates a return/credit request** for any shortages or damaged items (pre-filled with the line items, quantities, damage descriptions, and photos)

3. **Return with Images + Editable Email** — when a return is generated from check-in discrepancies, all attached damage photos carry over to the return record. The return detail page includes an **"Email to Vendor"** action that:
   - Auto-generates an email from a **standard template** (professional return request with item list, quantities, damage descriptions, and attached photos)
   - Opens the email in an **editable preview** before sending — you can customize the subject, body text, add context, adjust tone, or remove items before hitting send
   - Templates can be configured in Settings (default return email, default credit request email, etc.) so the starting point is always professional and consistent
   - Photos are included as attachments in the email

Both the vendor invoice and the completed check-in form are accessible from the order detail page (side-by-side view). Orders with discrepancies are flagged in the order list with a warning badge.

### Phase 5: Advanced Features — POs, Returns, Shipments, Buying Shows

**Purchase Orders**: Multi-step creation flow (select vendor → add line items → shipping info → review → send). **Export as PDF or Excel** — each PO can be downloaded or attached in either format. PDF for professional vendor-facing documents, Excel for when vendors need an editable spreadsheet. Both formats can be attached to emails sent to vendors. Receive workflow to mark items received.

**Returns & Credits**: Return form with type/reason selection, RMA tracking, credit memo tracking, status workflow (pending → approved → shipped back → credit received → resolved). Overdue highlighting.

**Incoming Shipments**: View built from orders where status is shipped/confirmed and arrival date is upcoming. **Date range search** to find all shipments expected within a custom window. Calendar/timeline view + table view.

**Buying Shows**: Show planning with vendor visit lists (priority, booth numbers), prep checklists with assignments, budget tracking (allocated vs. spent per vendor), link POs to shows.

### Phase 6: Reports, Product Sourcing, File Manager, Settings

**Reports**: Pre-built templates with Recharts — Spending Report, Order Status, Vendor Performance, Payment Report, Buying Show ROI. Date range pickers, store filters, CSV export.

**Product Sourcing**: Research table for items being sourced — product, potential vendors, estimated cost, status.

**File Manager**: Browse by entity type or flat list. Upload to Supabase Storage. Download via signed URLs. Tag-based filtering. In-browser preview for images/PDFs.

**Settings**: User management (invite, roles, store access), store info, categories CRUD, rep groups CRUD, import/export, notification preferences.

### Phase 7: Integrations

**Lightspeed POS**: Supabase Edge Function with OAuth2, syncs product catalog on schedule via pg_cron.

**QuickBooks Online**: Edge Function with OAuth2, syncs vendors and paid orders as Bills/Expenses.

**Email (Outbound)**: Edge Function + Resend/SendGrid for sending POs to vendors and notification digests to users.

**Email (Inbound) — Vendor Attachment Filing**: When you receive an email from a vendor with attachments (invoices, order confirmations, price lists, catalogs), the system can automatically file those attachments to the correct vendor folder. Implementation:
- **Email forwarding**: Forward vendor emails to a dedicated system address (e.g., `files@yourdomain.com`). A Supabase Edge Function receives the inbound email via webhook (Resend/SendGrid inbound parse).
- **Auto-detection**: The system matches the sender email to a known vendor in the database. If matched, it identifies the attachment type based on keywords in the subject/filename (e.g., "invoice" → Invoice folder, "confirmation" → Order Confirmation folder, "price list" → Price List folder, "catalog" → Catalog folder).
- **Vendor file folders**: Each vendor has organized sub-folders: Invoices, Order Confirmations, Price Lists, Catalogs, General. Attachments are automatically sorted into the right folder.
- **Review queue**: If the system can't confidently identify the vendor or attachment type, the file goes to a review queue where you can manually assign it to the right vendor/folder.
- **Manual filing**: You can also drag-and-drop or upload files directly to a vendor's folders from the Vendor Detail page or File Manager.

## Companion Spec and Overrides

This document is the base build plan. It is extended and, in specific places, overridden by `vendor-pipeline-and-platform-spec.md` in the same folder. Section 12 of that spec is the authoritative list of overrides. The ones that change this document directly:

- **Tenant layer above stores.** An `organizations` table sits above `stores` and must be in the first migration. RLS checks organization first, then store access. Storage paths are partitioned by organization. (Spec §11.2)
- **Branding is tenant-driven.** The Shaver Lake Sports palette and logo are the defaults for organization #1, not hardcoded values. (Spec §11.4)
- **Store GS** is The Happy Camper General Store. Import maps `HAPPY` and `HC` to GS. (Spec §2)
- **Vendor table additions** in Spec §7: aliases, assigned buyer, return notes, rep name/phone, pickup address/times, shipping contact/phone, plus new tables `vendor_emails`, `vendor_sales_reports`, `vendor_sku_cost_history`. `files.invoice_type` gains `order_confirmation` and `comparison_report`.
- **Inbound email** uses Gmail API read access on the orders mailbox, not forwarding. (Spec §10.1)
- **Email-based vendor enrichment** moves to Phase 3, right after the vendor import. Attachment auto-filing stays in Phase 7. (Spec §13)
- **Return emails** are AI-drafted from Dana's sent-mail history and per-vendor return notes; Settings templates are the fallback. Review-before-send is unchanged. (Spec §6)
- **Roles** stay admin / manager / buyer / viewer. Buyers are Dana and JW. (Spec §11.3)

**Operating model.** No developer on staff. Dana defines and tests; Claude Code writes all code, sets up database and hosting, and fixes bugs. Dana does account-level setup (Supabase, Vercel, GitHub, keys) following numbered steps. Secrets live in `.env` locally and environment variables in hosted environments, never in the repo or chat. Railway is reserved for background workers only if Supabase Edge Functions prove insufficient.

## What We Build First

We start with **Phases 1 and 2 together** — project scaffolding, Supabase database schema, auth, and the responsive layout shell. This gives us:
- A real database with the right schema from day one
- Working authentication with role-based access
- The app shell that every page lives inside
- Routing to all pages (even if most are placeholder)

Then we move into Phase 3 (data layer + import Dana's spreadsheets) and Phase 4 (Dashboard, Vendors, Orders) to get the core functionality live.

## Verification

- `npm run dev` starts the app
- Login works with real Supabase auth
- Sidebar navigation routes correctly on desktop, tablet, mobile
- Store selector filters data appropriately
- Supabase migrations apply cleanly
- Spreadsheet import script loads Dana's real data
- CRUD operations persist to the database
- RLS prevents users from seeing other stores' data
- All four stores (SLS, SLH, SLM, GS) are seeded and selectable
