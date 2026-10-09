# Decisions Log

Decisions made by Dana after the specs in this folder were written. Where an entry
conflicts with `development-strategy.md` or `vendor-pipeline-and-platform-spec.md`,
**this log wins**. Newest entries at the bottom.

## 2026-10-02 — No store selector; orders default to SLS

- Context: SLS receives all inventory for SLS, SLM and GS. Orders for another store
  are rare. The store column on the Placed Order Summary turned out to be unnecessary.
- Decision: there is **no store selector** in the top bar and no "active store" concept
  in the UI. Lists show everything. The strategy's `StoreContext` is not built.
- The `store_id` column stays on orders and related tables (sales reports are per
  store, and the import must map `HAPPY` / `HC` to GS). The order form pre-fills SLS
  and the field is only changed on the rare SLM or GS order.
- Reports get an optional store filter. That is the only place store selection appears.
- SLH stays in the `stores` table and remains active for now; 98% of its orders go
  through Emery-Jensen (Ace Hardware) and it is expected to see little use.
- Supersedes: strategy Phase 2 "Topbar: Store selector dropdown" and "StoreContext";
  strategy Verification item "Store selector filters data appropriately".

## 2026-10-02 — No QuickBooks integration

- Context: the QuickBooks Online sync in the strategy's Phase 7 came from a separate
  accounting app Dana is working on. It is not part of this project.
- Decision: **no QuickBooks integration** of any kind. Paid orders are tracked in this
  app only; nothing is pushed to accounting software.
- The order status lifecycle (`... → ready_to_pay → paid`) is unchanged; it is internal
  tracking.
- Store codes SLS / SLH / SLM / GS remain as short labels; the spec's note that GS "is
  the code used in QuickBooks" is historical and not a requirement.
- Supersedes: strategy Phase 7 "QuickBooks Online"; spec §2 QuickBooks reference.

## 2026-10-02 — Pipeline confirmed; payments are logged by upload, not by API

- Confirmed as part of this project: Lightspeed sales reports, the Google Drive
  `/RetailHQ/Vendor Reports/` watcher, and the Gmail orders-mailbox pipeline (spec §4, §9, §10).
- **How vendors get paid.** About 60–70% of orders are paid through the Worldwide
  Distributors portal (a buying group; no API, "old school"). The rest are paid through
  Bill.com. There is no accounting-system integration (see the QuickBooks entry above).
- **Decision: payments are recorded by uploading a payment sheet**, not through an API.
  When Dana pays Worldwide she creates one spreadsheet per payment batch; uploading it
  marks the matching orders paid. The app must:
  1. Read the batch date and total from the title cell (`WORLDWIDE PAYMENT 8-20-26  $7216.46`)
     and the filename (`8-20-26_WORLDWIDE_PAYMENT_7216.xlsx`).
  2. Match each row to an order by **Worldwide invoice number** first, then by vendor name
     and amount as a fallback. The Vendor column can be blank on some rows.
  3. Mark matched orders `paid` with payment date, payment method `worldwide`, batch
     reference, and amount; rows with `Desc = CRD` are credits (negative amounts) and
     should attach to the vendor's return/credit records rather than an order.
  4. Send unmatched rows to a review list instead of failing the upload.
  5. Capture early-payment discount data when present (`Disc Date`, `Disc Avail`).
- **Bill.com payments are logged the same way: by uploading a Bill.com payment report.**
  Goal: every payment date, amount and reference is visible in the VMS on the vendor and
  on the specific order, so Dana never has to log into Bill.com to check a payment.
  - Match each report row to an order by vendor plus the vendor's invoice number, with
    amount as a tiebreaker; unmatched rows go to the same review list as Worldwide rows.
  - Store on the payment line: payment date, amount, Bill.com payment/confirmation number,
    and method (check / ACH / card) when the report provides it.
  - Payment history is shown on the vendor detail page and on each order's detail page,
    with the Worldwide and Bill.com uploads feeding the same `payments` / `payment_lines`
    tables.
  - **Dana supplies a sample Bill.com export** (CSV or Excel) before Phase 5 so the parser
    can be built against the real column layout.
- **Credit card prepayment.** Some orders are prepaid by credit card at the time of
  ordering. **Every Faire vendor is paid by credit card.** Prepaid orders are therefore
  already paid before they are confirmed, shipped, or received: payment status must be
  tracked separately from the fulfilment status, so an order can be `paid` and still be
  `awaiting_confirmation` or `shipped`. The "ready to pay" step does not apply to them.
- Sheet layout (header row 2, data from row 3, `=SUM()` total in the last row of column J):
  `Invoice # | Disc Date | Disc Avail | Date Inv | Date Due | Desc (INV/CRD) | Vendor | Inv Amt | Amt Paid | Amt Due`.
  An anonymized template is in `docs/samples/worldwide-payment-template.xlsx`. Real payment
  sheets contain vendor and dollar data and are **not** committed to the repo.
- **Ordering method and billing route are two different facts.** Most Worldwide orders
  are placed through the vendors' reps at the bi-annual buying shows (Worldwide has
  hundreds of vendors); only occasionally is an order keyed on the Worldwide portal. In
  both cases Worldwide bills and collects. The same vendor may also be ordered through
  Faire, in which case Faire bills and the card is charged. So each order records:
  - `ordered_via` — how it was placed: `rep_at_show`, `rep`, `worldwide_portal`, `faire`,
    `vendor_direct`, `other`. Informational. Links to the buying show and rep when relevant.
  - `billed_through` — who invoices and collects: `worldwide`, `faire`, `vendor`.
    **This is what drives payment.** `worldwide` → paid in a Worldwide batch upload;
    `faire` → credit card, prepaid; `vendor` → Bill.com unless prepaid by card.
  - Vendors are tagged with the billing routes available for them (`vendor_billing_routes`,
    usually one: most are Worldwide vendors). The order form pre-fills `billed_through`
    from the vendor's usual route; the buyer changes it only on an order placed elsewhere.
- Adds to the schema (Phase 4/5): `payments` (batch) and `payment_lines`; on `orders`
  `ordered_via`, `billed_through`, `payment_method` (`worldwide`, `billcom`, `credit_card`,
  `other`), `payment_status` (`unpaid`, `prepaid`, `paid`) and `paid_at`, kept separate
  from the fulfilment status; `vendor_billing_routes` (vendor, route, is_default, notes).

## 2026-10-02 — Dashboard alert for unrecorded Bill.com payments due

- Decision: the dashboard shows a **"Payments due" alert** listing orders billed direct
  (the Bill.com route) whose invoice is due soon or overdue and has **no payment recorded**
  in the VMS. Counts split into *overdue* and *due within 7 days*, each linking to the
  filtered order list; the alert clears as Bill.com uploads or manual payment entries
  are recorded against those orders.
- Due date source, in order of preference: the due date on the vendor invoice (extracted
  when the invoice is uploaded, or entered by hand), otherwise invoice date plus the
  vendor's payment terms (e.g. net 30), otherwise order date plus terms. Orders with no
  usable date are listed under "no due date" rather than hidden.
- The same card can later include Worldwide invoices due if wanted; the first version
  covers the Bill.com route only, as requested.
- Phase 4 (Dashboard). Needs `orders.invoice_due_date` and `vendors.payment_terms_days`.

## 2026-10-02 — Bill.com "Payments Out" export: layout and the "Multiple" problem

- The upload is Bill.com's **Payments Out** export, one row per payment. Columns:
  `Confirmation number | Vendor | Process date | Payment status | Payment method |
  Payment amount | Arrival date | Invoice number | Paid from | Vendor credit | Currency`.
  Dates are text like `Sep 21, 2026`. Anonymized template:
  `docs/samples/billcom-payments-out-template.xlsx`. Real exports are not committed.
- **`Invoice number` says `Multiple` when one payment covered several bills.** Dana does
  not want to print each payment to get the numbers. Decision: the VMS resolves these
  itself from the invoices it already holds:
  1. Single invoice number → match that vendor's order by invoice number, amount as check.
  2. `Multiple` → find the combination of that vendor's **unpaid invoices in the VMS**
     whose total equals the payment amount. One combination → assign automatically.
     Several, or none → review screen listing the vendor's unpaid invoices with the
     payment amount at the top; Dana ticks the ones it covered. Nothing is lost: the
     payment is still recorded on the vendor with its confirmation number and date.
  3. Vendors in the export that are not VMS vendors (rent, utilities, fuel, batteries...)
     are listed under "not a VMS vendor" and skipped, not treated as errors.
  4. Re-uploading an export is safe: rows are deduplicated on confirmation number.
- Stored per payment: confirmation number, process date, arrival date, method
  (ePayment / Check / Virtual Card), status, amount, "paid from" account label.
- If Bill.com offers a bill-level export (one row per bill with invoice number and
  payment date), the importer accepts that too and it removes the `Multiple` ambiguity.
  Worth checking under Bill.com's Reports or the Bills list export, but not required.
- A free-text invoice value such as `August 2026` is treated as a reference, matched by
  vendor + amount like `Multiple`.

## 2026-10-02 — Excluded Bill.com payees; remittance sheets and statement reconciliation

- **Excluded payees.** Dana will supply a list of Bill.com payees that are not VMS vendors
  (e.g. Powell & Son Properties = SLS rent/mortgage). Kept as a per-tenant list in
  Settings ("Bill.com payees to ignore"); the importer skips them silently. New unknown
  payees still surface once under "not a VMS vendor" so the list can be extended.
- **High-frequency delivery vendors (Mountain Milk pattern).** Today: the assistant types
  each invoice into a per-store spreadsheet (SLS, SLM, GS); Dana pays the total through
  Bill.com and emails the vendor the spreadsheet as a remittance advice; the vendor sends
  one statement per store. Decision: automate both ends in the VMS.
  1. **Invoice capture.** Invoices are entered or uploaded (photo/PDF) against the vendor
     and store; the app extracts invoice number, date, store and amount (Claude Call 3
     style extraction, with manual entry as the fallback). The assistant does the same job
     inside the VMS instead of in a spreadsheet.
  2. **Remittance sheet.** "Pay vendor" on the vendor page lists unpaid invoices (filter by
     store), Dana ticks them, and the app produces the remittance spreadsheet in the same
     layout the vendor already receives, records a pending payment for that total with the
     invoices attached, and emails it to the vendor (download in Phase 5; automatic email
     once outbound email exists in Phase 7). When the Bill.com export is later uploaded,
     the payment matches by vendor + amount and the invoices flip to paid.
  3. **Statement reconciliation.** Upload each store's statement (PDF/photo). The app
     extracts the statement lines and compares them with VMS invoices for that vendor and
     store, flagging: on the statement but not in the VMS (missed invoice), in the VMS but
     not on the statement, amount differs, and paid in the VMS but still open on the
     statement (vendor has not applied the payment). Missing invoices can be added from
     the reconciliation screen as placeholders pending the paper copy.
- Phase 5 (Returns/Credits + payments) for 1–2, Phase 6 for 3. Dana supplies the current
  per-store Mountain Milk spreadsheet so the remittance layout matches exactly.

## 2026-10-02 — Mountain Milk remittance sheet layout; TOWN and MARINA store aliases

- Layout (sent to the vendor as PDF, one per monthly payment covering all stores):
  title `MOUNTAIN MILK PAYMENT`; columns `Store | Delivery Date | INVOICE # | AMOUNT | NOTES`;
  rows grouped by store with a `TOTAL PAID <STORE>` subtotal after each group; a
  `Grand Total` row; a note such as `PAID VIA DIRECT DEPOSIT ON 9-17-26`. The grand
  total ($16,139.81 in the sample) is the Bill.com payment amount, whose invoice
  reference reads `August 2026`. Template: `docs/samples/mountain-milk-remittance-template.xlsx`.
- The vendor-facing generator in Phase 5 reproduces this layout, with the title and
  payment note built from the vendor name, payment method and date. Delivery date is
  the invoice date for delivery vendors.
- **Store aliases:** the sheet uses `TOWN` for Shaver Lake Sports and `MARINA` for
  Shaver Lake Marina (`HAPPY` for GS was already known). Added to `stores.aliases` in
  migration `20261002000002_store_aliases.sql` and to `STORE_CODE_ALIASES` in the app.
- **"NEEDS CORRECTED INVOICE"** is a per-invoice flag: the invoice was paid but the
  vendor owes a corrected copy. The VMS keeps it as an invoice status flag that shows in
  the remittance NOTES column and on the statement reconciliation until a corrected
  invoice is uploaded against it.

## 2026-10-02 — Delivery-vendor invoices arrive by email like every other vendor

- Mountain Milk (and similar delivery vendors) email invoices to the orders mailbox, so
  they flow through the standard inbound pipeline (spec §10.1): classified as an invoice,
  filed to the vendor's Invoices folder, and the invoice number, date, store and amount
  extracted. No manual invoice entry by the assistant.
- Consequence for the schema: **vendor invoices are first-class records**
  (`vendor_invoices`), optionally linked to an order. For standing delivery vendors there
  is no order placed beforehand, so an emailed invoice creates its own order record
  automatically (one per invoice, marked as a delivery, status received) so that
  check-in, payment, remittance and reconciliation all work the same way as for ordered
  goods. A vendor flag `is_delivery_vendor` turns this behavior on.
- Store on an invoice is identified from the ship-to / store name on the document using
  the store names, codes and aliases (TOWN, MARINA, HAPPY, HC) and the store addresses.
  **Dana enters each store's street address in Settings** so address matching works;
  until then, name/alias matching is used and unmatched invoices go to the review queue.

## 2026-10-02 — What a Mountain Milk invoice batch looks like (sample reviewed)

Sample: `10.1.26_MM_ALL_INVOICES.pdf`, 10 pages, produced by Adobe Scan on a phone.
Not committed (real data). Findings that shape the invoice reader:

- **One PDF holds many invoices, one per page, as images with no text layer.** The
  pipeline must split multi-page attachments per page, read each page with vision
  (Claude handles scanned PDFs natively), and create one invoice record per page.
  A batch may mix stores and dates.
- **Fields on each invoice:** vendor name/address, `Date`, `Invoice #` (6 digits, e.g.
  302984), `DATE DUE` (equals the invoice date, i.e. due on receipt), `DELIVER TO` block,
  `RECEIVED BY` signature, line items (`Item`, `Description`, `QTY`, `PRICE EA`, `Amount`),
  a `FUEL SURCHARGE` line, free-text notes, and `TOTAL`.
- **Store is on the last line of DELIVER TO**, not the name line. The name line is the
  same across stores ("SHAVER LAKE SPORT & FISHING"); the last line reads `TOWN STORE`,
  `MARINA` or `Happy Camper`. Matching must be case-insensitive whole-word containment
  against store names and aliases (TOWN, MARINA, HAPPY) so "TOWN STORE" and "Happy
  Camper" resolve without new aliases.
- **Handwritten annotations** such as `Entered in LS 9/9/26 CP` or `LS=9/9/2026 TJ`
  record when the invoice was entered in Lightspeed and by whom. The VMS replaces this
  with the order's `entered` status (date + user). The reader should capture the
  annotation when legible and store it as a note, but never depend on it.
- **"No invoice on delivery"** printed in the line-item area means the paper copy was not
  left at delivery; this emailed copy is the only one. Capture as a flag/note.
- **Price-change notices** in the footer ("For the month of Sept, milk is down a small
  amount. Check your new prices.") are worth surfacing: extract as a vendor notice and
  show it on the vendor page / dashboard alerts so price updates are not missed.
- **Line items feed cost history.** Item code, description, qty and unit price go to
  `vendor_sku_cost_history` like any other vendor, which makes the fuel surcharge and
  per-bag ice prices trackable over time.
- Received-by signatures identify the employee who accepted the delivery; optional to
  capture as text, never required.

## 2026-10-02 — Adjustments and corrected invoices (second Mountain Milk batch reviewed)

Sample: `8.26.26_MM_INVOICES_ALL_STORES.pdf`, 26 pages, scanned together by the
assistant for this review only. Not committed.

**Normal flow (per Dana):** Mountain Milk emails each invoice individually as it is
issued, weekly, to the orders mailbox **with a CC to Bill.com**, so the bills already
exist in Bill.com when Dana pays. The paper copy left at delivery is what store staff
annotate by hand. The emailed copy is clean.

**How adjustments happen today:**
1. Store staff mark the paper invoice at delivery: items not received are crossed out,
   quantities corrected (e.g. 240 → 210), the fuel surcharge and total recomputed by hand
   (e.g. invoice 302388: $995.00 → $753.60; invoice 302479: $1,452.20 → $1,303.28).
2. The assistant enters the **adjusted** amount on the payment sheet with the note
   `NEEDS CORRECTED INVOICE`. Dana pays the adjusted total.
3. Howard at Mountain Milk emails a corrected invoice. It keeps the **same invoice
   number**, prints `+++++CORRECTED INVOICE+++++` under the line items, and marks changed
   lines with `+++++` (e.g. `FUEL SURCHARGE+++++`, `ICE - CRUSHED - 16# BAG+++++++`). A
   removed item may appear with quantity 0 and amount 0.00 rather than being dropped.

**Decision: the VMS replaces the handwriting with the digital check-in and tracks the
correction cycle on the invoice record.**
- The emailed invoice creates the invoice/order record (see the delivery-vendor entry).
  Store staff check it in on a phone: received quantity and status per line (the
  strategy's Phase 4 check-in form). Short or missing lines produce an **adjusted amount
  due** computed by the app (line amounts plus the fuel surcharge recalculated at the
  same rate), and the invoice is flagged `needs_corrected_invoice`.
- The remittance sheet and the pending payment use the adjusted amount, and the NOTES
  column carries `NEEDS CORRECTED INVOICE` exactly as today.
- When an emailed invoice arrives with an **invoice number that already exists** for the
  vendor, it is treated as a corrected invoice (confirmed by the `CORRECTED INVOICE`
  text when present): the original file is kept as version 1, the new one becomes the
  current version, line items are replaced, and the flag clears automatically if the
  corrected total equals the adjusted amount. If it does not match, the invoice goes to
  the review queue with both totals shown.
- A vendor-level "request corrected invoice" email can be drafted from the flagged
  invoices (Phase 5, with the AI-drafted vendor emails), so Dana does not have to write
  to Howard by hand.

**Bill.com consequence:** because invoices are CC'd to Bill.com, Bill.com holds each bill
with its invoice number. A bill-level export from Bill.com (if available) would therefore
resolve `Multiple` payment rows exactly; the vendor + amount matching remains the fallback.

**Also seen:** `No invoice on delivery` lines; handwritten `Inventory AS 7/30` and
`Entered in LS` notes (replaced by the check-in/entered status); price notices in the
footer change month to month and should be captured per invoice date.

## 2026-10-02 — Check-in mode is per store; Marina stays on paper

- Dana runs SLS and GS, so staff there can check deliveries in on a phone. **Marina
  (SLM) staff will not have VMS access**; the paper invoice stays the record there and
  is annotated by hand as today.
- Decision: each store has a `checkin_mode` setting, `digital` (SLS, GS) or `paper` (SLM).
  Both end in the same place: an adjusted amount due and the `needs_corrected_invoice`
  flag on the invoice record.
  - **Digital:** store staff fill in the check-in form on a phone.
  - **Paper:** the annotated paper invoice is photographed or scanned (the assistant
    already does this). Uploading it to the invoice in the VMS opens an **Adjust invoice**
    screen pre-filled by reading the handwriting: crossed-out lines, corrected quantities,
    corrected totals. The assistant confirms or edits, then saves. The same screen works
    with no photo at all for a purely manual adjustment.
- The assistant (initials "CP" on the invoices) therefore needs a VMS login, role
  `manager`, with access to all three delivery stores. Created via Settings in Phase 6 or
  `npm run db:create-user` before then.
- Marina's Lightspeed entry is done by TJ ("TP/TJ" initials on the marina invoices); the
  VMS `entered` status is set by whoever enters it, from any store's invoice page.

## 2026-10-02 — Correction: Mountain Milk invoices are paper; the assistant emails the scans

- **Mountain Milk hands a paper invoice to each store at delivery.** The assistant scans
  them and emails the scans to the orders mailbox and to Bill.com. **Howard only emails
  the corrected invoices.** This replaces the earlier assumption that the vendor emails
  each original.
- Consequence: the first copy the VMS sees is the store's paper copy, which may already
  carry handwritten adjustments ("Entered in LS", crossed-out lines, corrected totals).
  So the invoice reader handles handwriting from the start: an incoming scan creates the
  invoice **and**, when annotations are present, a proposed adjustment in the same step.
  The assistant confirms the proposed adjustment in the review queue (one click when it
  is right), which sets the adjusted amount due and the `needs_corrected_invoice` flag.
- This makes the "paper" path the default for all three delivery stores. The digital
  check-in form at SLS and GS remains available but is optional for delivery vendors;
  a digital check-in done before the scan arrives simply takes precedence.
- The assistant keeps emailing scans exactly as today; nothing changes for her on day
  one. Once outbound email exists (Phase 7), the VMS can forward the scan to Bill.com
  itself so she sends it once.
- Corrected invoices from Howard arrive by email directly from the vendor and are
  matched by invoice number as already described.

## 2026-10-02 — Delivery vendors: who they are and how each is handled

"Delivery vendor" = a route vendor that drops goods with a paper invoice and bills for
what was left; no order is placed beforehand. Flagged `is_delivery_vendor` on the vendor.

| Vendor | Goods | Invoices reach the VMS how | Payment | Notes |
|---|---|---|---|---|
| Mountain Milk & Cream | milk and ice, all three delivery stores | assistant scans the paper and emails to orders mailbox + Bill.com | Bill.com, monthly remittance sheet | adjustment/corrected-invoice cycle as recorded above |
| Rod's Power Bait | worms (live bait) | assistant emails the invoices to orders mailbox + Bill.com | Bill.com, **must be paid immediately** | see "pay now" rule below |
| Frito-Lay | snacks | not emailed; prepaid at delivery | prepaid | **not tracked in the VMS**; add to the excluded-payee list if it ever appears in a Bill.com export |

**"Pay now" rule.** Vendors carry payment terms; Rod's Power Bait is `due on receipt`
(0 days). When an invoice for a due-on-receipt vendor is recorded from the mailbox, it
appears on the dashboard's "Payments due" card **immediately**, in its own "pay now"
group above overdue and due-soon, with the vendor, invoice number and amount, linking
to the invoice. It leaves the card when the Bill.com payment report is uploaded and the
payment matches (vendor + invoice number, or vendor + amount for `Multiple` rows, as Rod's
payments in the sample export show), or when a payment is entered by hand.

## 2026-10-02 — Payments-due alert covers every direct-billed vendor, with per-vendor lead time

- Dana has several other vendors paid through Bill.com outside Worldwide and wants the
  dashboard to alert when their payments are due. The "Payments due" card already covers
  **every** invoice whose billing route is `vendor` (direct, paid through Bill.com) and
  that has no payment recorded, so no separate list is needed.
- Refinement: vendors get `payment_terms_days` (net 30, net 15, 0 = due on receipt) and
  `alert_days_before_due` (default 7). The card groups invoices as **pay now** (due on
  receipt, or past due), **due soon** (within the vendor's lead time), and shows a count
  of the rest. Dana sets terms and lead time on the vendor page; the vendor import
  pre-fills terms from the spreadsheet where present.
- Worldwide-billed invoices are excluded from this card by default because they are
  paid in batches on the portal; a toggle can include them later if wanted.

## 2026-10-02 — Payment terms are an admin-managed list

- Decision: payment terms are a per-organization list managed by admins in Settings
  ("Payment terms"), not a free-text field. Vendors choose from the list; the order and
  invoice records keep a snapshot of the terms that applied.
- Each term has: name (e.g. "Net 30", "Due on receipt", "2% 10 Net 30"), days until due,
  optional early-payment discount (percent + days), optional fixed due day of month
  ("bill on the 1st, due on the 15th"), active flag, and one term marked as the
  organization default. Admins can add, rename, deactivate (never delete terms in use),
  and reorder.
- Seed for organization #1: Due on receipt (0), Net 15, Net 30 (default), Net 45, Net 60,
  2% 10 Net 30. Dana adds anything else from Settings.
- Schema: `payment_terms` table (organization-scoped, RLS like other tenant tables);
  `vendors.payment_terms_id`; `orders`/invoices keep `due_date` resolved at creation.
- Phase 6 (Settings) for the admin screen; the table and seed go in with the vendor
  schema in Phase 3 so the import can map the terms column to list entries.

## 2026-10-02 — Lightspeed Retail R-Series: build sales reports from the API, run them before each show

- **Lightspeed version:** Retail R-Series. Its Analytics reports are not exposed by the
  API, but the underlying data is (items with default vendor, vendor SKU, cost, per-store
  on-hand and reorder points; sales lines by date; vendors; purchase orders). To be
  verified with a test call once API credentials exist; the documentation sites are
  blocked from the build environment.
- **Decision: the VMS generates vendor sales reports itself from the Lightspeed API**,
  applying the NEED/ORDER logic from `sales-report-formatting-spec.md`. The Drive
  `/Incoming/` upload (spec §4.1, §9) stays as a manual fallback for reports the API
  cannot reproduce or if API access is delayed.
- **Pre-show report run.** The comparison must use the report the buyer relied on at the
  show, not data pulled when the confirmation arrives weeks later. So each buying show
  has a `report_run_days_before` setting (default 14; Dana can change it per show). On
  that date the VMS runs the sales report for every vendor on the show's visit list
  (optionally all active vendors), stores each as a new `vendor_sales_reports` version
  attached to the vendor **and tagged with the show**, and notifies the buyers. Buyers
  take those reports to the show. A "Run now" button on the show and on any vendor
  covers late additions.
- **Versioning rule, extended.** An order linked to a buying show compares against the
  report version tagged with that show. An order not linked to a show uses the spec's
  rule: the most recent report dated before the confirmation. The report run date and the
  365-day window it covered are shown on every comparison.
- **Mobile confirmation scan at the show.** Many vendors hand over a paper copy of the
  order at the booth. From the phone, "Scan confirmation": camera capture (multi-page),
  the active show pre-selected, vendor matched from the document (booth list as a hint),
  line items extracted, order created with `ordered_via = rep_at_show` and
  `billed_through` from the vendor, and the comparison runs immediately against the
  show's report, so missing items, new items and price changes are visible while the
  buyer is still at the booth. If the document is the buyer's own order copy rather than a
  vendor confirmation, the order is created as `awaiting_confirmation` and the emailed
  confirmation later attaches to it instead of creating a duplicate.
- Needs from Dana (Phase 4): Lightspeed API credentials (app registration; numbered steps
  will be provided), the account ID, and a sample of TJ's exported report to confirm each
  column maps to API data.

## 2026-10-05 — Batch of decisions from the 10/02–10/05 review

### Report used for an order (amends the versioning rule above)
- There is always a sales report before an order is placed; more may be run afterwards to
  double-check. Each order has a **"report used"** link. The report tagged for the show is
  pre-selected; the buyer can tick a different version at any time. The confirmation
  comparison always uses the ticked report and shows which one it used. Later reports are
  kept as versions but never used unless ticked.

### Scanned confirmation: is it the only copy?
- The scan screen asks "Is this the only confirmation you'll receive?" Yes → the order is
  `confirmed` from the scan alone. No → `awaiting_confirmation`; the emailed confirmation
  attaches to the same order and the comparison reruns against it.

### Discrepancy email after the comparison
- The comparison screen shows checkboxes on confirmation lines in question (price, quantity,
  substitution, unrequested new item) and on sales report lines the vendor left off
  (missing). "Email vendor" drafts a message from the ticked items only: short summary, a
  table of ordered vs confirmed, the confirmation attached. Editable before Send; the email
  and replies are stored on the order.
- **Recipient resolution never trusts the confirmation's sender.** Order: the vendor's
  assigned rep (from `vendor_emails`, type `rep`), then the rep group contact, then the
  vendor's orders address. The confirmation sender is offered as an extra recipient only if
  it is a real person, never a no-reply address. Dana is always CC'd; recipients are editable.

### Mobile scan quality
- In-browser capture with automatic corner detection, perspective correction, brightness/
  contrast normalization, shadow removal, multi-page with reorder/retake, output as one PDF.
  Built on open-source image processing (OpenCV.js class). The same screen accepts PDFs
  shared from Adobe Scan or the iOS scanner; a paid scanning SDK is an option later.

### Uploader role
- Fifth role `uploader`: a single "Upload invoice" screen (scan/upload, pick vendor if not
  recognized, submit) plus a list of their own uploads and status. No vendors, orders,
  costs, dashboard or reports. Store-scoped via `user_store_access`; uploads stamped with
  store and user. Intended for Marina staff; managed in Settings. Added to the `user_role`
  enum in migration `20261005000001_uploader_role.sql`.

### Sales reports hub (vendor and category)
- Two report types, vendor and category, each with **Quick run** (one button, standard
  definition: last 365 days, all stores, standard columns, NEED/ORDER for vendor reports),
  **Custom run** (date range, stores, vendor/category) and **Compare** (a date range, which
  may cross a year boundary, repeated for N prior years side by side: units and dollars per
  item, year-over-year change and change from the earliest year; Excel export and chart).
- Standard definitions are edited by admins in Settings. Every run is saved as a version on
  the vendor or category (`sales_reports` with a `scope`), so "report used" works for both.
- Dana's existing Claude projects for the reports go into `docs/`; they define the standard
  category report and other report behaviors. Add notes on what Lightspeed Analytics could
  not do.

### Lightspeed data: own copy, raw fields, nightly snapshots
- Lightspeed Analytics is not used. The VMS pulls raw data from the R-Series API and keeps
  its own copy: sales lines (incl. cost at time of sale), items (all fields incl. Vendor ID,
  UPC, custom SKU, category path, prices, matrix attributes, tags), per-store stock with
  reorder points, vendors, categories, manufacturers, employees, purchase orders, transfers,
  inventory counts. Nightly sync with a one-time backfill of sales history (4+ years).
- Lightspeed exposes only current stock levels. **A nightly inventory snapshot starts the day
  the connection goes live**; history builds forward only. Connect Lightspeed as early as
  possible so there is history by the February show.
- Derived metrics (sell-through, turns, days of supply, dead stock, margin trends,
  season comparisons) are computed in the VMS from the raw copy.

### Purchase orders in Lightspeed from confirmations
- TJ uses Lightspeed POs. From a confirmation the VMS creates the Lightspeed PO for the
  vendor and store with quantities, unit costs and expected arrival. Lines are matched to
  Lightspeed items by Vendor ID, UPC, then custom SKU; unmatched lines are shown and the
  match is learned once a person picks the item.
- **New items are proposed, never auto-created.** The proposal follows Dana's naming
  convention rules (to be placed in `docs/`; may differ by category or vendor): description,
  vendor, Vendor ID, UPC, cost, suggested retail (if markup rules exist), suggested category.
  They sit on a "New items to approve" list; whoever checks in reviews each against the
  confirmation line and approves before anything is created in Lightspeed. Optional
  confidence-based auto-approve later, off by default.
- Receiving in Lightspeed is read back (received quantities, date, shortages) and sets the
  VMS order to `received`/`entered` automatically; shortages feed discrepancies/returns.
- The Lightspeed app registration needs write scopes for inventory and purchase orders.

### Terminology
- **"Vendor ID"** = the vendor's item number on a Lightspeed item (Lightspeed's own label).
  Used everywhere in the VMS for that field. The vendor record is called "vendor", never
  "vendor ID".

### Open and future-dated orders must be impossible to miss
- Example: ordered in February, ships September 15. Buyers must not double-order at the show.
- Orders record both `ship_date` (from the confirmation) and `expected_arrival`. An order
  placed well ahead of its ship date is labeled a **pre-booking**.
- Vendor page and the vendor's sales report screen show a banner: open orders with date
  placed, ship date and total, each linking to the order (line items listed) and to the
  confirmation document.
- The vendor sales report gets an **"On order"** column per item (quantity and expected date
  from open orders, matched by Vendor ID) and the NEED calculation subtracts it.
- Buying show visit list marks vendors with open orders; the scan screen warns before a new
  order is scanned for such a vendor. Dashboard lists future-dated orders (ships > 30 days out).

### Sessions, hosting and running costs
- Cloud sessions remain the default workspace; a Local session with Nick present can be used
  for one-time steps that need browser logins (Vercel project, Lightspeed/Google OAuth apps).
  Vercel stays the hosting plan; Railway only if Supabase background jobs prove insufficient.
- Estimated running cost once live (current published pricing, confirm at signup):
  Supabase Pro ~$25, Vercel Pro ~$20, Claude API ~$10–40 (higher in show months), Gmail/
  Drive/Lightspeed APIs and GitHub $0. Roughly $70–100/month. One-time email backfill
  ~$50–150.

### Lightspeed Analytics subscription
- SLSI currently pays $225/month for Lightspeed Analytics (three stores at $75). The VMS
  reports replace it, so the net running cost of the VMS is below what Analytics alone
  costs today.
- Do not cancel Analytics until VMS reports have been validated against it for a full
  cycle (ideally through the February show) and anything worth keeping has been exported.
  The sales history backfill uses the Lightspeed API, not Analytics, so it does not
  depend on the subscription.

### Overdue orders
- An order is **overdue** when **30 days have passed since the quoted ship date** and the
  order has not been received. The 30 days is an organization setting so it can be tuned,
  but 30 is the rule. Example: quoted ship date 9/1, nothing received by 10/1 → overdue.
- Orders past their ship date but inside the 30 days are shown as "shipping late" on the
  order itself, without an alert.
- Dashboard: an "Overdue orders" card with the count and a list (vendor, order number, ship
  date, days late), each row linking to the order and its confirmation document.
- Vendor page: a red banner on open, repeated on the vendor's sales report screen and marked
  on the buying show visit list, so an overdue order is seen before a new one is placed.
- "Check status" on an overdue order drafts an email to the rep (same recipient resolution
  as the discrepancy email), editable before send; replies attach to the order.
- Optional daily email digest of overdue and future-dated orders once outbound email exists.

## 2026-10-05 — Ordering calendar per vendor and an ordering guide

- Each vendor records **when SLSI typically orders from them**: an ordering frequency
  (`weekly`, `monthly`, `seasonal`, `annual`, `as_needed`) and one or more ordering
  windows (`vendor_order_windows`: month(s) or a start/end date in the year, a kind such as
  `feb_show`, `aug_show`, `pre_season`, `reorder`, `delivery`, free-text notes such as
  "winter goods by Oct 15 for Nov delivery", and the usual buyer). Imported from the vendor
  spreadsheet where a column exists; editable on the vendor page.
- Once order history exists, the VMS also shows **"usually ordered in"** derived from past
  order dates (last three years) next to the manual windows, and flags vendors whose manual
  windows disagree with history.
- **Ordering guide**: a list, generated for any month or date range (default: this month
  and next), of vendors due to be ordered from, with last order date, open orders, the
  ordering window note, the rep contact, and a link to run the sales report. Available from
  the Vendors page ("Order this month" filter), as a dashboard card with the count, and
  printable/exportable. Vendors in the window with no order placed by its end are flagged.
- Buying show visit lists can be pre-filled from vendors whose window is that show.
- Phase 3 for the fields and import; Phase 4 for the history-derived view, the dashboard
  card and the guide.

## 2026-10-05 — Phase 3 vendor data: Lightspeed export first, then email, then a vendor intake form

- The vendor contact spreadsheet is not ready and may never be the primary source. Phase 3
  order of sources:
  1. **Lightspeed vendor export (CSV from Inventory → Vendors → Export)** gives the
     authoritative vendor names (plus any account numbers / contact fields present). Imported
     first; names are kept exactly as Lightspeed has them so sales reports and POs match.
  2. **Orders mailbox backfill (Gmail API)** proposes contacts, roles, phones, websites,
     remit-to details and return patterns per vendor, matched to the Lightspeed names; senders
     that match no vendor are proposed as new-vendor candidates. Everything through the review
     queue, nothing auto-written (spec §5).
  3. **Vendor intake form.** Each vendor gets a private, unguessable, expiring link to a public
     form on the VMS (no login): rep name/phone/email, orders email, AP contact, customer
     service contact, remit-to address, payment terms, website, shipping contact, will-call
     pickup address and hours, minimum order, return policy notes. Submissions go to the review
     queue; Dana accepts or edits. Requests are sent from the orders mailbox (Gmail send scope,
     pulled forward from Phase 7) to the best-known address, for one vendor, a selection, or
     all, in batches of 30–40 per day with plain personal wording; the VMS tracks responses
     and can send a reminder after 14 days. Public endpoint is rate-limited and token-scoped.
  4. The spreadsheet, if finished later, imports as a gap-filler (categories, ratings,
     ordering windows, minimums) without overwriting reviewed data.
- Lightspeed API registration moves into Phase 3 so vendor names, categories and the nightly
  inventory snapshot start as early as possible.

### Lightspeed vendor names carry "WWD" / "NOT WWD" suffixes
- Some Lightspeed vendor names end in `WWD` or `NOT WWD` (variants with dashes, parentheses
  or different case must be handled). On import: strip the suffix from the display name, keep
  the exact Lightspeed name in `vendors.lightspeed_name` and in `aliases` so sales reports and
  POs still match, and set the billing route: `WWD` → Worldwide vendor (billed through
  Worldwide), `NOT WWD` → bills direct. Names with neither suffix get no route yet and are
  listed for Dana to classify. Nothing is renamed in Lightspeed.
- The route shows as a badge ("Worldwide" / "Direct") on the vendor list and page and drives
  the default `billed_through` and payment method on new orders.
- Likewise `Faire` in a Lightspeed vendor name: strip it from the display name, keep the
  exact Lightspeed name as an alias, and add the **Faire** billing route (credit card,
  prepaid). A vendor can end up with more than one route (e.g. Worldwide and Faire) if
  Lightspeed has separate vendor entries for the same company; the import proposes a merge
  into one vendor with both routes, keeping both Lightspeed names as aliases, for Dana to
  confirm.


## 2026-10-05 — Lightspeed vendor import completed
- Imported from `10-5-26_SLS_LS_Vendor_Export.csv` (1,079 rows): 771 enabled rows → **767
  vendors** (4 exact duplicate groups merged, e.g. "RUKO - WWD" + "RUKO"), 322 Worldwide,
  33 Faire, 3 Direct, 414 with no route yet. 15 possible duplicate pairs and the 4 merges
  are in the review queue and flagged on the vendors; Dana reviews them from the vendor list
  ("Needs review" filter) or the review workbook sent in chat.
- Only 22 rows carried any contact/phone data in Lightspeed; contacts come from the mailbox
  backfill and the vendor intake form.
- Import script: `npm run import:ls-vendors`. Re-runnable; existing vendors are skipped.

## 2026-10-05 — Contacts per vendor, vendor intake form writes directly, fishing sheet as gap-filler

- **Contacts.** Lightspeed's single contact/phone is not enough. The VMS keeps **any number of
  contacts per vendor** in `vendor_emails`, each with a role: rep, orders, accounts payable,
  customer service, shipping, other. Several contacts can share a role (two or three orders
  contacts), one per role can be marked primary. Each has name, title, email, phone, source
  and a verified date. Vendor-level fields stay for the rep, will-call pickup and shipping
  contact summary; new fields `freight_program` and `product_types` (migration 0009) from
  Dana's contact sheets.
- **Vendor intake form updates the database directly** (changes Dana's earlier review-first
  idea for this source, because the vendor is the authority on their own contact details).
  Rules: a submission adds new contacts and fills empty fields immediately; a change to an
  existing value is applied too, with the previous value kept in the activity log and the
  vendor marked "updated by vendor form on <date>"; Dana gets a daily summary notification of
  what changed; a submission arriving on an expired or unknown link goes to the review queue
  instead. Reverting any field is one click from the vendor's activity history. (Supersedes
  the "submissions go to the review queue" line in the Phase 3 vendor data entry.)
- **Fishing vendor contact sheet** (`FISHING_VENDOR_CONTACT_LIST.xlsx`, 29 vendors, columns
  Vendor / Type of products / Min order / Freight programs / Rep group / Rep name / Phone /
  Email / Notes): imported as a gap-filler after the Lightspeed import. Matched by name to
  existing vendors; fills rep name/phone, adds the rep email as a contact, sets minimum order,
  freight program, product types and notes, creates rep groups; vendors not found in
  Lightspeed are created and flagged for review. Dana created it last year, so the mailbox
  backfill may propose newer reps; those arrive as review suggestions.
- **Orders mailbox**: not on Google Workspace yet. Dana is migrating it now; the backfill
  waits for the migration with attachments intact.

## 2026-10-05 — "Do not order" flag
- Vendors get `do_not_order` (checkbox) and `do_not_order_reason` (free text). It is a
  **warning, not a block**: shown as a red badge on the vendor list, a red banner on the
  vendor page, and (Phase 4) a confirmation prompt on the order form and the show scan
  screen. Ordering remains possible if the buyer decides to.
- Set now: **Puka Creations** (too many broken items; the asterisks in its Lightspeed name
  meant this) and **American Dream Home Goods** (twice could not deliver what was ordered,
  outrageous shipping, too late to source elsewhere).
- Three other Lightspeed names carried a trailing asterisk (Leisure Concepts Intl, Maxxsel
  Apparel, Terramar): names cleaned, originals kept as aliases, review items ask Dana what
  the asterisk meant. The import parser now strips asterisks and dangling "&".

## 2026-10-05 — Duplicate review actions, Lightspeed merge report, WWD show list
- **Review actions are explicit** (Dana: "'Looks right, clear the flag' — keep both or merge
  them?"). For a pair flagged as a *possible duplicate*: **Keep both, not the same** or
  **Same vendor, merge** (choose which record to keep; contacts, routes, windows, notes and
  aliases move into it; the other record stays inactive for history and points at the
  survivor). For a vendor *merged automatically at import*: **Yes, one vendor** or **No, split
  one out** (pick the Lightspeed name; it becomes its own vendor again, or the original record
  is revived if it had one). Asterisk markers: **Handled** / **Dismiss**. The "flagged for
  review" banner clears itself once nothing is pending for that vendor; the plain "clear the
  flag" button only appears when there is no question to answer.
- **Route choice on every action** (Dana: "I need to be able to tell you if it's WWD or Faire
  or not"). Each merge, confirm or split takes an optional WWD / Faire / Not WWD (direct)
  choice that becomes the result's usual route. "Leave as is" keeps what the import tagged.
- **Lightspeed merge ledger and report** (Dana: "I'm going to need to go into LS and merge
  those vendors there too"). Every merge is recorded in `vendor_merges` (keep this LS name,
  merge that LS name into it, route, who/when, confirmed / awaiting OK / split back out).
  The report at `/review/merges` lists what to do in Lightspeed, grouped by the record to
  keep, with a **Done in LS** checkbox per line and a CSV download. VMS-only vendors (no
  Lightspeed name) show in "Everything" but never in the to-do list.
- **Review queue page** at `/review` (admin, manager, buyer): all pending items grouped by
  kind with the same actions as the vendor page; dashboard card shows the pending count.
- **Worldwide show vendor list = reference directory, not vendors** (Dana: "All of these
  vendors are WWD. We don't order from all of them, but keep it in a file so when an email
  comes in it checks if it's a WWD vendor"). Loaded into `vendor_directory` with
  `npm run import:vendor-directory` (route worldwide, name, email domain, booth, every other
  column kept). Used two ways: (1) when the mailbox scan or the intake form creates a new
  vendor, a name or email-domain hit presets the route to WWD; (2) existing vendors that match
  the list and have no route yet can be tagged WWD with `--apply-routes` (vendors already
  tagged differently are listed for Dana, never changed).

## 2026-10-06 — Rep lines, show lists, catalogs, zero upcharge (Dana's files)
- **Lines are not vendors.** A line is something a rep carries or a Worldwide show lists.
  Lines live in their own list (`vendor_directory`, shown as "Lines") with the rep group,
  catalog link, show specials, which shows it was at (booth, exhibitor) and WWD if it was on
  a show list. Dana: "I don't really want to add vendors to our database that we have never
  bought from before, but I may want to look at a catalog." A line becomes a vendor only when
  someone clicks **Make a vendor**; the rep group, route, catalog link and show history carry over.
- **Rep groups from rep lists only, never guessed from shared booths.** A booth with many
  lines is sometimes a rep (DandyLines) and sometimes one company's brands (Coleman: Ball,
  bubba, FoodSaver). Rep groups are created from the line lists reps send (Donna Hoffman /
  DandyLines-Diverse Marketing, Maryellen Reynolds). The show list only records booth-mates
  on each vendor ("shared booth 1615 with …"); turning a booth into a rep group is a human call.
- **Rep group pages** list the vendors we buy from and the other lines they carry (catalogs).
  Each vendor page shows its rep group with contact details and "also reps …".
- **Rep changes** are made on the vendor; history stays in the activity log. Show lists never
  change a rep group by themselves.
- **Show lists** (Worldwide Exhibitor Listing + ShowTime line listing PDFs) record attendance
  per show. Rule restated: on the list ⇒ WWD; not on the list ⇒ nothing (never Direct).
  Vendors tagged without WWD that appear on a list are reported, not changed. Service
  booths (payments, insurance, FFL software, NSSF, Guns.com) are skipped. Shows are named
  as Worldwide names them: **Spring show** (Feb, winter goods) and **Fall show** (Aug/Sept,
  next summer's goods).
- **WWD zero upcharge**: Worldwide adds 1.5% to drop-ship most vendors; zero-upcharge vendors
  do not carry it. Flag on the vendor (`wwd_zero_upcharge`, badge "WWD 0% upcharge") and on lines.
- **Catalog and price list links/files**: a "Catalogs, price lists & files" section per vendor
  (type, label, season, link or uploaded file up to 25 MB in the private `vendor-files`
  bucket). Older ones stay as history. Automatic filing of email attachments starts once the
  Gmail/Drive connection exists; until then Dana pastes links or uploads PDFs by hand.
- **Maryellen Reynolds**: all 13 lines are Not Worldwide (Direct, paid through Bill.com).
  Kaufman set to do-not-order with her note. Trees to Trees stays a catalog-only line (new
  to her; never ordered).
- **Donna Hoffman (DandyLines / Diverse Marketing)**: 48 lines with SharePoint catalog
  folders and Fall 2026 specials; 13 are vendors in VMS (rep group, zero upcharge, catalog
  and specials links set), 35 are catalog-only lines.
- **Tagged Lightspeed names** ("POLAR MAGNETICS - Maryellen", "COLEMAN - NEWELL BRANDS"):
  38 proposals sit in the review queue as "Name clean-ups". Rep tags become the rep group,
  parent-company tags become aliases, the Lightspeed name is always kept as an alias. Dana
  approves each (editable) or all at once; nothing is renamed without her.

## 2026-10-06 — Worldwide contacts box, Spring 2026 show, Workspace question
- **Our contacts at Worldwide** (Dana: "an info box for all WWD vendors that lists our
  contact info with WWD"). Every vendor with a WWD route shows a box: Member #816, main line
  253-872-8746, the Accounts Receivable specialist who handles our member range (Arsenia
  Miyaji, ext 339), the vendor liaison for that vendor's initial (A-L Jill Matthews, M-Z
  Sydney Engel), the warehouse line (ext 323) and the warehouse manager. The full 46-person
  roster lives under Settings → Worldwide, where the people shown in the box can be changed.
  Extensions go with the main number. One roster email had a typo'd domain
  (worldwidebuygoup.com); stored corrected, noted on the contact.
- **Spring 2026 show** loaded from the full ShowTime packet (line listing pages only; the
  packet has no separate exhibitor listing, so booth holders are unknown for Spring but
  booth-mates still show). 826 lines, 111 of our vendors, 13 got WWD. 52 vendors appear at
  both 2026 shows.
- **Google Workspace**: moving the orders mailbox to Workspace changes nothing about how
  mail is read. Gmail stays the inbox; VMS reads through Google's API (read-only until
  sending is wanted), never moves or deletes mail, and links back to the original message.
- **2025 shows loaded** (same day): Spring 2025 from the "Line Listing" table (single column,
  booth + Zero Upcharge Y column) plus its exhibitor listing and Worldwide's zero-upcharge
  vendor list; Fall 2025 from its exhibitor listing only (each exhibitor counted as a line,
  names split on "/"); the Fall 2025 line listing is still to be found. Zero-upcharge status
  from a show list sets the vendor flag (45 vendors now); Dana can untick on the vendor form.
  Look-alike names the matcher must not link go in `--skip` (e.g. Taylor's & Co. vs Taylor Brands).
- **Fall 2024** loaded from its exhibitor listing (two columns). Four shows plus Fall 2024 now
  give every vendor its show history back to August 2024.

## 2026-10-06 — Which show an order came from (rule for Phase 4, Dana)
- When the Placed Order Summary is imported, each order gets a **show tag** inferred from its
  date: Spring show = late January to mid February, Fall show = late August to early
  September (exact dates per year from the show packets, e.g. Feb 1–4 and Sept 1–3, 2026).
- A **WWD vendor's** order dated inside the window or up to 30 days after is "from the show";
  31–60 days after is "probably from the show" (orders trickle in that long); later is a
  reorder. If the vendor was on that show's line listing the tag is firmer; otherwise it is
  shown as inferred.
- **Not-WWD vendors** get no automatic show tag; it can be set by hand on the order.
- The show tag is an editable field on the order; the ordering guide and the "what did we
  buy at the last show" views use whatever is on the order.

## 2026-10-06 — Orders arrive early: the Summer WWD Order Guide (Placed Order Summary) is in
- Dana uploaded the "8-25-26 Summer WWD Order Guide v6" workbook built from the Placed Order
  Summary (Open / Entered / Paid tabs, by buyer and by season) and asked for every order and
  payment date to show on the vendor record, with the paper behind it attached later.
  The Phase 4 orders table was created now to hold it (one row per order, every column the
  sheet tracks, status history, documents). Line items, check-in and the pipeline stay Phase 4.
- **Re-uploadable**: orders are keyed by vendor + date + what was ordered + cost + store, so
  the fresh copy of the living sheet before go-live updates in place (status changes included).
- **Vendor matching**: 312 of the 328 sheet spellings linked to existing vendors (sheet
  spellings kept as aliases: "WFS" style differences stop mattering next time); 16 we have
  ordered from but had no record for were created and flagged to check for duplicates.
  Spellings that differ only by a rep tag or "(…)" are one vendor.
- **From the guide onto the vendor**: Category (61 categories created), Report owner (Trevor
  64, Jarrett 52, Dana 34, shown on the vendor page until they have logins), "Do Not Order /
  Out of Biz" → do-not-order with the reason, "Do Not Need" → a note.
- **Statuses**: 1-Open → open, 2-Entered → entered, 3-Paid → paid. Both paid-date columns
  are kept: "Date Paid (Dana)" = Bill.com, "Paid Date (WWD)" = Worldwide portal.
- **Show tag** inferred per the earlier rule for WWD orders (617 of 1,104 got one; the vendor
  page shows a "?" when it is inferred). Hand-typed dates that are not real dates (June 31,
  "8/22/25 & 9/3/25") are kept as typed on the order, not guessed.
- **Dashboard**: Open orders and Payments due now count real orders.

## 2026-10-06 — Needs list (staff requests that are not vendor orders), Gmail folders
- Dana files staff requests (office supplies etc.) in Outlook folders "Need to Order" and
  "Placed Orders". VMS gets a **Needs list** (Phase 4, after the Gmail connection): one line per
  request with requester, item, store, status Needed → Ordered → Received, shown on the
  dashboard. A Gmail label "Need to Order" feeds it automatically with a link back to the
  email; marking it Ordered in VMS swaps the Gmail label to "Placed Orders". A request links to
  the order record once placed, whatever the source (Amazon, Uline, Sam's Club are vendors).
  Staff may also add a need directly in VMS from a phone.
- Outlook folders arrive in Gmail as labels via the import and stay as history. VMS files
  vendor mail by vendor on its own and never moves or relabels Gmail mail unless asked.
- Workspace status: Business Starter, 8 licenses; users orders, dana, jarrett, trevor, cat,
  annette, raelee (new, nothing to migrate); jobs@ becomes an alias on Dana. Migration from
  Microsoft 365 (GoDaddy) via the Admin console data import, dana@ first as the test.

## 2026-10-06 — Lightspeed categories are not trusted yet; category clean-up is the first LS job
- Context from Dana: before 2022 anyone could enter orders and items, so Lightspeed categories
  are unreliable. Fixed as found since then; ~26,000 SKUs to start, many still wrong.
- VMS derives nothing from LS categories (fishing flag, reports, vendor product types) until
  the clean-up pass. The **first job after the Lightspeed connection**: pull every item with
  description, vendor, category and sales; flag items whose description does not fit the
  category (Claude reads descriptions against the category list and the naming rules) with a
  suggested category; a review page grouped by vendor and suggested category with bulk
  approve; write back to Lightspeed only what was approved, every change logged and
  reversible. Naming rules document from Dana feeds this.
- Fishing flag today is hand-set (40 vendors). Coyote Vision and Sona are general vendors
  that happen to sell some fishing items: not flagged. Coast, Frogg Toggs, Smith's 1886 and
  Mike Reddin flagged on Dana's say-so.

## 2026-10-06 — Lightspeed category standard drafted for sign-off
- From the Oct 5 LS exports (16,771 items, 1,017 categories): 85 categories lack a size
  breakdown, 33 lack age/gender, 35 have items sitting above an existing breakdown, nine size
  spellings are in use, and two category names were mangled by Excel (`10-Aug`, `14-Dec`).
- The standard is written up in `docs/lightspeed-category-standard.md` (mirror of the Claude
  Doc Dana and Trevor review). Ladder department > type > age (INFANT, TODDLER, KIDS, YOUTH,
  ADULT) > gender (MENS, WOMENS, BOYS, GIRLS, UNISEX) > size (XS, SM, MED, LG, XL, 2XL, 3XL,
  4XL; guides in parentheses like `MED (10/12)`; infant months, toddler T sizes). All caps,
  straight apostrophes only, no inch marks, no commas; slashes, dashes and `&` are safe.
  Tents by person bands, coolers HARD by quart / SOFT > BAGS by can / SOFT > BACKPACK,
  canopies by footprint, umbrellas RAIN/CHAIR/BEACH, pet items XS–XL, life jackets keep their
  weight bands. Stickers, fishing line, rope, chargers, nets get no size rung.
- Ten open points carry defaults (ADULT UNISEX as two rungs, no shoe-size rungs yet, sleeping
  bags by age only, JUNIORS → YOUTH, sub-type before age, misfiled items moved, the two date
  names renamed, WFS guide under every kids branch, helmet/goggle rungs, Trevor's live work
  kept). Dana and Trevor sign off; the standard is corrected to match.
- Nothing changes in Lightspeed from the document. Next: a proposal spreadsheet (new
  categories, renames, item moves) from the latest export, approved by branch in VMS, written
  back only after the LS connection, every batch logged and reversible.

## 2026-10-06 — Category standard: three answers; review items get an assignee
- Dana: footwear gets the full clean-up with shoe sizes (`HIKING > ADULT > WOMENS > 8.5`); misfiled
  items move to the size their name says (yes); the two Excel-mangled names are renamed (yes).
  Written into the standard; open inside footwear: plain numbers (default) or a leading zero so
  the picker sorts 8 before 10.
- Dana: "I'm going to want to be able to assign the reviews to an employee. Like all fishing
  reviews go to Jarrett." Every review item now has an assignee. **Rules** in Settings > Review
  assignments pick it when the item is created: one vendor, fishing vendors (the fishing flag,
  or a FISHING department on the item), a Lightspeed department, a kind of review, or everything
  else; lower priority runs first, the most specific kind wins a tie. Editors can hand an item to
  anyone from the queue; admins can run the rules over items already waiting. The queue opens on
  "Mine" when you have items, with Everyone / Unassigned / per person filters. The migration adds
  the fishing → Jarrett rule as soon as his account exists. The same rules will route the
  category clean-up batches and the second-pass mismatches.

## 2026-10-06 — UNISEX is a gender rung; one-size items get a ONE SIZE rung
- Dana: "adult/unisex because it should be considered a gender. So we would have
  sweatshirts/adults/unisex." Two rungs everywhere: `ADULT > UNISEX`, `KIDS > UNISEX`,
  `YOUTH > UNISEX` (juniors are YOUTH). The old one-line `ADULT UNISEX` names are renamed.
- Dana: a one-size-fits-all item gets a size: `SWEATSHIRTS > ADULT > WOMENS > ONE SIZE`. Spelled
  `ONE SIZE`, never `OS`, `OSFA` or `O/S`. So nothing with an age or gender stops above the size
  rung; only things with no age or gender (tents, coolers) stop at the type.

## 2026-10-06 — Size names must sort in order
- Dana: "I like things to sort in order. So we probably need to add the leading zero." Lightspeed
  sorts category names alphabetically, so size names are written to sort: shoe sizes `05`,
  `05.5` … `13` (youth 13 moves into KIDS 8-13 so every run counts up), bands start with the low
  number (`0-19 QT`, `0-15 CAN`), infant months `00-03M`, `03-06M`, `06M`, `06-12M`.
- Open: letter sizes only sort with a number in front (`1 XS`, `2 SM`, `3 MED (10/12)` …). Default
  in the standard is to add it; Dana and Trevor to confirm.

## 2026-10-06 — Trevor and Jarrett get VMS accounts
- Dana: "I need Trevor & Jarrett to be able to login to help me finish setting this up." Both
  created as **managers** (edit everything; Settings and user roles stay with admins) on their
  Workspace addresses with access to all four stores. Temporary passwords handed to Dana outside
  the repo; the account menu now has **Change password** (the reset page, reachable while signed
  in) because the project's default mailer cannot send reset emails to staff addresses.
- Accounts were created straight in the auth tables through the Management API: the proxy here
  does not carry the service-role key the `db:create-user` script needs. Dana can switch either
  of them to admin by asking, or later from Settings > Users once that page exists.

## 2026-10-06 — Youth sizing on hold
- Dana: "I'm not sure we should do away with youth. I need to research that tomorrow." YOUTH stays
  an age rung. Two proposals wait on her research: retiring JUNIORS in favour of YOUTH, and one
  KIDS rung where a vendor (World Famous Sports) sizes kids and youth as one run. No proposal sheet
  row touches youth until she decides.

## 2026-10-06 — Letter sizes carry a sort number
- Dana: "Point 11, yes add the 1, 2, 3 etc." Letter sizes are `1 XS`, `2 SM`, `3 MED`, `4 LG`,
  `5 XL`, `6 2XL`, `7 3XL`, `8 4XL`, guides after them (`3 MED (10/12)`); `ONE SIZE` takes no
  number. Applies to clothing, footwear sold by letter, pet items and helmets. The 140 branches
  spelled SMALL/MEDIUM/LARGE, SM/MD/LG or XS–XL today all take the numbered names in the clean-up.

## 2026-10-06 — Only Dana is an admin
- Dana: "No one should be admin but me." Trevor and Jarrett stay managers. Role changes are
  admin-only in the database (the profiles policy and the role-column trigger), so nobody can
  promote themselves; the Settings > Users page, when built, lets Dana alone change roles.

## 2026-10-07 — Planned: scheduled replenishment check (after the Lightspeed connection)
- Dana asked whether VMS can check a vendor's Lightspeed inventory on a schedule and say when it
  is time to order, using the vendor's minimum order and free-shipping threshold, and show it on
  the dashboard. Yes; planned as the first feature after the Lightspeed API connection.
- Vendor fields it needs (build them with this in mind): minimum order, free-shipping threshold,
  lead time, order windows / season, report owner. From Lightspeed: on-hand, vendor and Vendor ID
  per item, sales history (days of cover per item).
- Nightly job per vendor: items at or below reorder point, suggested order priced at cost,
  compared to the minimum and the free-shipping line, with the order window and the next show in
  view. Dashboard panel "Orders to look at": one line per vendor (suggested total, what it is
  short of or clears, driving items, assignee), one click to a draft order.
- Prerequisite: items in Lightspeed carry the right vendor, part of the category and item
  clean-up.

## 2026-10-07 — Freight discipline and seasonal sync (Dana's context for replenishment)
- Vendors are not equal: the replenishment check must respect each vendor's own minimum,
  free-shipping line and ordering rhythm, never one rule for all.
- Goal: get back in sync with the two shows (spring and fall) instead of ordering once a year,
  order less often, and land above free-shipping thresholds. Freight has run 30 to 60 percent of
  product value on some orders this year, 120 percent once (Daisy, routing instructions ignored;
  full credit won, but it took March to October).
- VMS needs: freight as a share of product cost on every order and on the vendor page; per-vendor
  **freight routing instructions** shown when an order is placed and checked against the invoice;
  a **dispute / credit** record on an order with an owner and a follow-up date that nags on the
  dashboard until the credit lands; the Placed Order Summary stays the source of truth until
  go-live.
- From the imported orders today: 433 orders carry a freight figure; freight is 10 percent of
  product cost overall, 36 orders at 30 percent or more, 10 at 50 percent or more.

## 2026-10-07 — Free shipping: the vendor's rule and each order's answer
- Dana: "We need a setting in vms to indicate NEVER free shipping vs sometimes free shipping. And
  a place for every order placed whether it qualifies for free shipping as a special or
  something... each order shows if it is supposed to be free shipping or not in addition to the
  system showing the normal shipping rules for that vendor."
- Vendor: **free shipping policy** (never / sometimes: show special or above a volume / always),
  **free shipping over** (order value at cost), **freight routing instructions**. Shown on the
  vendor page; the old free-text freight program stays as notes.
- Order: **Is this order supposed to ship free?** Yes / No / Not stated, with a reason (show
  special, hit their volume, negotiated, vendor always does, other) and a note. The order page
  shows it in a Shipping card beside the vendor's usual rule, our routing instructions and the
  freight actually billed, and warns when they disagree (free from a "never" vendor, under the
  volume with no special, over the volume yet charged, freight billed on a free order). Order
  lists carry a "free ship" or "+freight" tag.
- Backfilled from the Placed Order Summary freight notes: 214 orders marked free, 439 marked paid
  (a freight figure above zero), 451 left unstated. 17 vendors got a "sometimes" rule with the
  threshold their notes state ("free @ $500"); Dana reviews them on the vendor pages.
- Caveat from Dana: shipping has been tracked carefully for about two years; before that it was
  hit and miss, so older orders say little about freight.

## 2026-10-07 — Vendor scoring
- Dana: "an automated scoring system based on ease of ordering, rep/vendor communication &
  willingness to help out, fulfilment on time or not, shipping issues and how well they resolve
  issues", plus "delivering damaged goods or mistakes on orders (quantities, or wrong item all
  together)". Six dimensions, 1 to 5: ease of ordering, communication and help, on-time
  fulfilment, order accuracy, shipping, resolving issues.
- Four score themselves from the order history today: fulfilment (received within a week of the
  ship date given), accuracy (damage, shortage or wrong-item notes per order), shipping (freight
  as a share of product cost, minus free-shipping breaches and late or lost notes), resolution
  (credits owed that came through, and how fast). Ease and communication are staff ratings until
  Gmail is connected. A staff rating on any line replaces the automatic score; history is kept.
- Shown as a Scorecard on every vendor page (rate any line in one click) and as Reports > Vendor
  scores, sortable, with the evidence counts. First run: 176 of 778 vendors scored from the
  order guide; Panther Martin, Wisconsin Pharmacal and Talahi at 5.0; Water Sports LLC at 1.0
  (freight 40.6 percent, four issue notes), Daisy at 1.0 on an open credit.
- Dana: after a full year in VMS (every season), the check-in form and the vendor emails about
  issues live in VMS, so every dimension scores itself. The check-in form feeds accuracy; email
  response times feed communication; Gmail threads feed ease and resolution.
- Clarified: what was imported is the Seasonal Vendors Buying Guide ("8-25-26 Summer WWD Order
  Guide v6"), gleaned from the Placed Order Summary. The Placed Order Summary v2.0 itself has not
  been uploaded yet; Dana will say which of its tabs to ignore when she does.

## 2026-10-07 — Vendor standing: fine / last resort / do not order, with the reason beside the stars
- Dana: "some of the vendors will be a no way on ordering again, others may be subjective and only
  if we can't find the items anywhere else. But I want it to show on the Stars why they are
  flagged that way (shipping fees, damaged goods ... or bad attitude)". Plus: mistakes on orders
  include missing or wrong hang tags (a WFS order tagged boys on girls' jackets).
- Every vendor has a **standing**: fine to order, last resort (only if the items are nowhere
  else), do not order. Reason **tags** (shipping fees; damaged goods or junk; order mistakes
  including wrong items, quantities and hang tags; does not deliver what was ordered; bad
  attitude; slow with credits; out of business; other) plus the free-text reason. Shown on the
  vendor header, the warning box, the vendor list, the scorecard under the stars, and the Vendor
  scores report. Still a warning, never a block.
- The old do-not-order flag follows the standing (trigger), so the seven vendors already flagged
  carried over: Puka (damaged goods), American Dream Home Goods (does not deliver, shipping
  fees), Leisure Concepts (out of business), Haddad, Kaufman, Troll, Ty (other, from the order
  guide and Maryellen's list).
- Order accuracy now also counts hang-tag notes (no tags, wrong tags) from check-in.

## 2026-10-07 — Standing: "on hold" with a review date; discontinued line and overstocked reasons
- Dana: add a reason "discontinued line" (we no longer want to carry their products). Troll is a
  high-end clothing line that ran its course; the store's market is vacationers who forgot
  something and do not want to spend a lot. Troll stays do-not-order, tagged discontinued line.
- Ty is not a do-not-order: too much stock on hand, some Ty toy types discontinued and others
  kept (worked out with Claude from the inventory numbers). New standing **on hold** with a
  **review date**: Ty is on hold until 2027-01-15, tagged overstocked; order again in January if
  enough has sold, otherwise wait and see what is new. Dana will upload the Ty data from those
  sessions.
- Planned for the Lightspeed connection: item-level tags per vendor (stop ordering these items,
  keep ordering those), driven by sell-through: push the fast turns, slow or stop the slow ones.
  The vendor standing says whether to order from the vendor at all; the item tags say what.

## 2026-10-07 — Ty analysis loaded; item-level buying rules exist now
- Dana uploaded "Ty Vendor Analysis v3" (Word for reading, Markdown for loading). Loaded into Ty's
  record: account number, rep Charlene Lal as a contact, free shipping "sometimes" at $2,500 with
  the half-freight floor at $1,000 in the freight notes, standing on hold with the review date
  moved to 2027-01-18 (count week), the decision rule in the standing reason, four vendor notes
  (decision rule and why $1,850; product types stop/keep with the numbers; nine buying rules
  learned; open items), a note on the ten backordered order lines to confirm status before the
  next order, and a category review item for the three Franklin pump items filed under
  WATERSPORTS.
- New table **vendor item rules** (per vendor: product type or one item by Vendor ID; reorder
  first / keep / watch / stop; reason, source, as-of date) with a "What to order from them"
  section on the vendor page. Ty seeded with 12 type rules and 36 item rules (27 stop, 9 reorder
  first). The standing says whether to order from a vendor; the item rules say what. The
  Lightspeed connection ties them to live items and lets sell-through propose new ones.
- Carry-forward facts from the analysis: Ty renamed Sparkle to Floppy (same item numbers; old
  Lightspeed records still say Sparkle); descriptions before 2023 are unreliable, item numbers
  and UPCs are not; zero sales with zero stock is a stockout, not a dead item.
- Open: source a North American wildlife plush vendor (bear, deer, fox, owl, raccoon); Ty has
  effectively exited the category and it is the store's best-performing one (about 89 percent
  sell-through). Goes on the Needs list when it exists.
- **Lightspeed merge defect** (ticket 215475329366619): merging an item that was archived then
  unarchived loses its sales history; reproduced twice, no engineering answer. The item clean-up
  must check archive history before any merge and never merge such items through Lightspeed's
  own merge until the defect is fixed. Several thousand duplicate records may be affected.
- The Word file is not attached yet: VMS file uploads run under a signed-in user, which this
  session does not have. Dana drops it on Ty's page under Links & files.

## 2026-10-07 — Ty backorders; VMS watches for patterns once Lightspeed is connected
- Dana believes every Ty backorder was cancelled by email with Charlene. First job for the Gmail
  connection: find those emails in the orders mailbox, confirm, and close the ten backordered
  Ty lines (noted on each line).
- Dana: the Ty analysis is the model for every vendor, and with the Lightspeed connection VMS
  should look for patterns all the time: monthly and seasonal sales by vendor and item, items
  to stop buying, the best time to buy, and when to hold off. Planned as the **pattern engine**
  that runs beside the replenishment check: per vendor, sell-through by product type and item,
  stockouts (zero sales with zero stock), velocity since arrival, shrink, seasonal windows by
  store; it proposes item rules (stop / keep / reorder first / watch) and standing changes
  (hold, review dates) into the review queue, never changes them on its own. Each proposal
  carries the numbers that drove it, the way the Ty document does.

## 2026-10-07 — Reading patterns from the old Lightspeed history despite bad names and categories
- Dana's concern: naming conventions and categories were not in place, so the history is messy.
  Rule for the pattern engine: trust item number, Vendor ID, UPC, vendor, quantity, sale date,
  cost and store; never trust the description or the category of an old record. Patterns by
  item and vendor read straight away; patterns by product type arrive as the category clean-up
  lands, because Lightspeed keeps the history on the item and it rolls up under the new
  category. Duplicate records split history: VMS joins them on its own side by Vendor ID or
  UPC and does not rely on Lightspeed's merge (see the merge defect above).

## 2026-10-07 — Workspace migration done; email signatures per person
- All six mailboxes imported (19,138 emails, 12 calendar events, 21 contacts, nothing failed);
  Outlook folders arrived as Gmail labels, orders@ checked by Dana. Next: check the other four
  mailboxes, switch MX at GoDaddy, activate Gmail, one delta import, jobs@ alias on Dana, keep
  Microsoft two more weeks.
- Dana: each employee gets their own email signature when VMS sends from orders@, based on who
  is signed in. VMS sends nothing until the Gmail connection; the signature lives on the VMS
  profile and Dana writes them when the connection lands (she hopes this week). Until then, a
  "Send mail as" orders@ address in each person's own Gmail gives per-person signatures.

## 2026-10-07 — Target: running well by December, ready for the WWD show Jan 25-28, 2027
- Dana: "I want this system running good by December so we are fully ready for show time at
  the end of January." Working back from that: Gmail connected in October; Lightspeed connected
  and the category clean-up under way by early November so the December sales land in clean
  categories; replenishment check and pattern engine live by the end of November; December for
  the show-prep view (vendors attending, minimums and free-shipping lines, item rules, open
  holds with January review dates, what to look at by vendor) and for everyone using it daily.

## 2026-10-07 — Email assignment per employee; interim Gmail labels VMS will read
- Dana used Outlook categories to mark which employee handles an email and pinned it; the
  migration did not carry categories. In VMS every vendor email gets an "Assigned to" (the
  review-queue picker) and the review assignment rules apply on arrival (fishing vendors to
  Jarrett). Assigned mail sorts to the top of that person's list, replacing the pin.
- Until the Gmail connection: nested Gmail labels `Assigned/<First name>` (Dana, Jarrett, Trevor,
  Cat, Annette, Raelee) applied by hand, plus a star for what was pinned. The Gmail connection
  reads those labels and turns them into VMS assignments, so this week's tagging carries over.

## 2026-10-07 — Mail is live on Google Workspace; VMS reads orders@ through a service account
- MX switched at GoDaddy (one record, smtp.google.com priority 1; a first attempt with a typo
  cost 40 minutes), test email landed in Gmail. Left to do: delta import then exit import, jobs@
  alias on Dana, staff on Gmail only, Microsoft kept two weeks, DKIM and DMARC from Oct 9.
- Gmail connection design: a Google Cloud project owned by the Workspace admin, Gmail API on, a
  service account with domain-wide delegation authorized in the Admin console for gmail.modify
  and gmail.send. VMS impersonates orders@ for reading, filing and sending; a send carries the
  signed-in user's signature. No per-user OAuth screens. The service-account key goes straight
  into Supabase secrets by Dana, never through chat or the repo. Sync runs as a scheduled
  Supabase Edge Function.

## 2026-10-07 — Google Cloud side of the Gmail connection is done
- Dana set it up herself: project named **SLS VMS** (her choice over "RetailHQ VMS"; ID `sls-vms`),
  Gmail API on, service account `vms-mail`, domain-wide delegation for gmail.modify and gmail.send in
  the Admin console, key stored in Supabase as `GOOGLE_SERVICE_ACCOUNT_JSON`, plus `GMAIL_MAILBOX`.
- New Google organizations block service-account keys by default; the block was switched off for the
  SLS VMS project only (Dana holds Organization Policy Administrator for that). It stays on elsewhere.
- Verified: VMS read the orders@ mailbox profile (16,748 messages). Next: build `gmail-sync` per
  `docs/gmail-connection.md`.

## 2026-10-07 — Gmail build: how unmatched mail is matched; first sync is 12 months
- Only 9 vendors have an email on file, so sender/domain matching alone would leave most mail
  unmatched. Dana: read the email for clues. VMS proposes a vendor per sender from the domain
  (wfsports.com → WFS → World Famous Sports), the From name and signature, the subject and
  attachment file names. One review item per sender, not per email ("@wfsports.com looks like
  World Famous Sports, named in 38 of 42 emails: Confirm / Pick another / Not a vendor").
  Confirming links all that sender's mail and remembers the sender so future mail matches on its
  own; "Not a vendor" hides the sender for good. Nothing is linked without a person's OK.
- First sync brings in the last 12 months only; older mail stays in Gmail and can be pulled later.
- Build order (Opus session): tables + sync + matching, then the Mail page, then sending with
  signatures. Not started yet; resumes the morning of Oct 8.
- Dana: rep signatures often list every company the rep carries, but each email still says which
  vendor it is about. So a rep group's sender is matched **per email**, not per sender: the
  signature block is ignored for vendor clues; the subject, body above the signature and attachment
  names decide. The sender is remembered as that rep group (not one vendor), and an email naming
  more than one of the rep's vendors, or none, goes to review on its own.

## 2026-10-07 — Screen rules: Back returns to where you came from; tables sort by header
- Dana: clicking a rep from a vendor page and then wanting to go back lands on the wrong list;
  from a review item the only way out was "All vendors" instead of the review queue. Rule: every
  detail page has a Back that returns to the previous in-app page, with the list's filters intact;
  cold opens fall back to the section's list. One shared component.
- Dana: on lists like outstanding orders, click a column header to sort by that column (vendor
  name, date, cost ...), click again to reverse. Rule for every table in the app, one shared hook.
- Added to CLAUDE.md as standing rules; the fix across existing pages is the next small-build job.

## 2026-10-08 — An email beside every phone on the vendor
- Dana: "anywhere that there is contact information, I want an email; that's how we do most of our
  orders." Vendors get three fields: **Orders email** (where orders go), **Rep email** and **Shipping
  contact email**, on the edit form, the vendor overview (clickable) and the vendor list. Each
  address is also added to the vendor's contact list so the Gmail connection recognises mail from it.
- Rep groups and Worldwide contacts already had email. Only 9 vendors had any email on file today;
  the Gmail contact backfill (spec §5) will propose the rest through the review queue.

## 2026-10-08 — Email a vendor from the vendor record; the thread saves to the vendor
- Dana: in a vendor record, a button to email any of that vendor's contact emails directly, and the
  correspondence saves to the vendor file. Part of the Gmail build: an Email button beside every
  address on the vendor page and a "New email" in its Mail section; sent from orders@ with the
  sender's signature, saved to the vendor at once, and replies in the thread follow it to the
  vendor. Written into `docs/gmail-connection.md`.

## 2026-10-08 — Vendor mail is worked in VMS; replies come back to the sender
- Dana: "I want us to be able to work directly in VMS most of the time, not having to go to Gmail."
  Agreed with Fable; written into `docs/gmail-connection.md` ("Working in VMS instead of Gmail").
- A vendor's reply goes to whoever sent the email, and every later message in that thread stays with
  the thread's owner; handing a thread to someone moves the rest of it.
- Sent mail waits on the vendor; no reply in five days puts it back on the owner's dashboard as
  "No answer yet" with a one-click follow-up (the Daisy credit took seven months).
- Dashboard "Mail for you" list (not just a count) plus a number on Mail in the side menu. A thread
  stays on your list until answered, marked handled, or handed to someone else (then it moves to
  theirs).
- Read, reply, forward, attach and open attachments all inside VMS; Gmail is the backup.
- Everyone sees every thread on the vendor record; ownership only decides whose list it lands on.
- No phone or email alerts from VMS for now.

## 2026-10-08 — Mail is live in VMS
- Built on Dana's go-ahead from the Gmail plan. orders@ syncs every minute; the first load brings in the
  last 12 months (about 100 emails a minute). Mail from known senders files itself; unknown senders wait
  in the review queue as "Who is this mail from?", one per sender, with a proposed vendor where the
  web address or the mail itself names one.
- Two answers added after the first sync: "Sends for many vendors" (NetSuite, Bill.com, FashionGo: each
  email filed by the vendor it names, like rep groups), and staff addresses (billing.slsports@gmail.com)
  always count as ours. A single passing mention no longer makes a proposal.
- History loaded by the first sync that has been quiet for a week starts as handled, so nobody's list
  fills with old mail. Threads only land on someone's list once they have an owner (sent it from VMS,
  an Assigned/<name> label, the assignment rules for its vendor, or handed over).
- Sending, replying, forwarding and following up happen in VMS from orders@ with the sender's name and
  signature; Dana writes signatures in Settings > Mail. A one-time self-test ("VMS send test, please
  ignore", orders@ to orders@) confirmed sending, threading and attachments.

## 2026-10-07 — Pull the Worldwide vendor portal into VMS
- Dana: the WWD member portal has, per vendor, address, contacts and sales reps, programs (minimum
  order, billing terms, freight terms, shipping points), product lines and resources (zero
  upcharge, defective goods policy, RA, returns address, compensation). She wants it all in VMS,
  then a bulk email asking vendors to confirm their details through the VMS form, because WWD's
  data is often stale.
- Plan in `docs/wwd-portal-import.md`: a reader script that runs on Dana's computer with her signed
  in (the cloud sessions cannot reach the portal), writing a git-ignored JSON file; an importer
  that fills empty vendor fields, keeps the whole record in `vendor_portal_data`, and puts contacts
  into the review queue. Nothing Dana typed is overwritten. Also worth one email to WWD asking for
  an export.

## 2026-10-07 — Vendor programs: standard and show, with history kept
- Dana: show vendors list a Standard program and a SHOW program (year, expiry, show discount, show
  terms, freight tiers, ship-date window). Keep every program, never drop an expired one: active
  green, expiring soon amber, expired gray with the expiry date, shown below the live ones. An order
  keeps a link to the program it was placed under so a shipment six months later can be checked
  against those terms. "I like history." Written into `docs/wwd-portal-import.md`.

## 2026-10-07 — Portal data lands directly; only conflicts go to review
- Dana: "I have not added hardly anything yet so I don't really want to review all those vendors
  before they land." For the WWD portal import, everything is written straight to the vendor
  record tagged "from the WWD portal, read on <date>"; contacts show as unconfirmed until the
  vendor confirms through the update form; only a portal value that differs from one Dana typed
  goes to the review queue. The review-queue-first rule stays for email-derived enrichment.
- WWD told Dana last year they had no vendor export. She will ask their tech department directly
  this time; the reader script is the fallback.

## 2026-10-07 — Mail views, file saving, five order sources, the PO stamp, sending, confirmation check
- Dana: Outlook sorted mail into Focused and Other; she wants the same in VMS: "Needs attention"
  (replies, confirmations, invoices, anything to act on) and "Offers & catalogs" (specials, price
  lists, catalogs), with a toggle, and price lists or catalogs from offers saved into the vendor's
  files automatically, links included, history kept.
- An order can start from a sales report, a vendor's order writer (uploaded, taken off an email,
  or downloaded from the WWD portal at show time; Jarrett uses these because prices and show
  specials are already right), a plain email we sent (VMS proposes, a person confirms), the
  "Create an order" form (all the fields a vendor needs, then pick the contact and send from
  orders@), or typed in after the fact. One order record with lines whatever the source.
- The Lightspeed PO is the stamp that the order was placed; the source document stays attached.
  Sending: one button on the order, the vendor's own filled sheet or a clean PO, from orders@ with
  the sender's signature; orders placed via the portal or a rep are marked so.
- When a confirmation matches exactly, VMS compares it line by line, shows the differences on the
  order, saves cost changes to the cost history, and drafts the email to the vendor for the order's
  owner to edit or send. Written up in `docs/orders-and-mail-plan.md`.

## 2026-10-08 — Mail views and files saving themselves are live; orders and vendors from email
- Built on Dana's go-ahead (Fable's plan sections 1 and 2, Opus session). Mail opens on "Needs
  attention"; "Offers & catalogs" holds Promotions-tab mail, newsletters and specials; "Everything" for
  searching. Unsure stays in Needs attention. Moving a conversation teaches that sender; Settings > Mail
  has "Re-sort all mail". The Claude read waits for an API key.
- Price lists, catalogs, specials and order forms from email save themselves into the vendor's files
  with the email linked; newest of each kind is current, older ones stay as history. Every rule runs
  over the stored mail too, and mail filed to a vendor later catches up on its own.
- Dana: Tyler bought hats from a new vendor with the company card. Any conversation (or "Who is this
  mail from?" card) now has "New vendor from this email" (form prefilled from the sender), and orders
  can be added by hand on the vendor page or from an email, with how they were paid (card, check,
  Bill.com, WWD, other) and the email linked. Fable's order plan builds lines and sending on top.

## 2026-10-08 — Claude API key for VMS; Claude reads the unclear mail
- Dana created the key herself: Claude Console org "Shaver Lake Sports Inc", workspace SLS VMS, key
  "vms" (no expiry, linked to Dana), $20 credit, auto-reload off, $25 monthly org limit, saved in Supabase
  as ANTHROPIC_API_KEY. Separate from the accounting automation's key.
- Dana chose the cheapest model for this work. Claude now sorts the emails the rules leave unsure into
  Needs attention or Offers, and reads "Who is this mail from?" senders with no guess (vendor from the
  list, rep group, sends for many vendors, or not a vendor) as a note on the card; Dana still decides.
  First readings: Bill.com and Faire as platforms, Maryellen as a rep, 4allpromos as not a vendor.
  Settings > Mail shows what Claude cost this month. The whole backlog costs well under $1.

## 2026-10-08 — Known reps are recognized by their address
- Dana: "Maryellen reps for more than just Planet Cotton." Her rep group (12 vendors, 13 lines) was on
  file but her address was not tied to it, so Claude summed her up from her three latest emails. Now a
  sender writing from a rep group's email on file is that rep group at once (no review card) and each
  email files to the one line of hers it names; emails naming none or several stay unfiled in Mail.
  Claude is also told the rep groups and their lines. First run: Maryellen 185 of 238 emails filed,
  DandyLines/Diverse Marketing (Donna) 13 of 46.

## 2026-10-08 — Vendors are assigned to who orders from them; Report owner retired
- Dana: Report owner was only who ran the sales report before the show; the person who orders from
  the vendor should own it now that VMS will run the report. Only Dana and Jarrett order. Exceptions:
  Raelee orders Kelli's Gifts, Cat orders Mountain Milk. Trevor ran reports but orders nothing.
- Every vendor has **Assigned to**, editable on the vendor page, in the edit form, and filterable on the
  Vendors list (Mine / a person / Unassigned). Only people marked as placing orders
  (`profiles.places_orders`, admins set it) can be picked: Dana and Jarrett today.
- Started from Report owner: Dana's 34 stay Dana's, Jarrett's 53 stay his, Trevor's 64 went to Jarrett,
  each with a "Who orders from these vendors?" review for Dana to keep or change. Kelli's and Mountain
  Milk stay unassigned until Raelee and Cat get logins.
- The assignee gets the vendor's review items and mail; a matching Settings rule (one vendor, fishing,
  department, kind) still wins, and the "everything else" rule comes after the assignee.
- Logins for Raelee, Cat and Annette wait for go-live; Raelee and Cat get `places_orders`. Jarrett and
  Trevor start troubleshooting once all phases are done.

## 2026-10-08 — Review-queue clean-up list (Dana, evening): vendors, contacts, mail matching, freight, pricing
Dana listed these while working the Review queue, then said go.
- **Delete from the Review queue** a vendor that never belonged (e.g. Shaver Lake Sports Internal
  Consumption): removed completely, and its names are remembered so imports never bring it back.
  Vendors we have bought from are never deleted.
- **Active / Inactive** switch on the vendor page; the Vendors list shows Active, Inactive or All.
  **Inactive vendors stay in every vendor picker, grayed out**; picking one asks "Reactivate this
  vendor?" (Reactivate and use / Cancel) without leaving the screen. Fewest steps possible.
- **WWD contacts** leave the vendor page (a small link stays) and get their own page in the menu for
  everyone; they are offered in the email To box. WWD is emailed only as a last resort.
- "Sends for many vendors" is renamed **"A service like Bill.com or Faire"**.
- **Several contacts per rep group and per vendor** (show reps differ from our rep). One rep is starred
  **Our assigned rep**: follow-ups go to them. Orders record **Order taken by** (e.g. the show rep).
  Every rep group contact's address is recognized in mail (Donna has two addresses).
- **Mail routing order**: (1) the full address: the domain counts when it contains a vendor or rep group
  name (@worldfamoussports.com, @dandylinesllc.com); the part before the @ (angie@) never counts by
  itself. (2) Subject and body: vendor name, alias, or a PO number, which matches an order on file or the
  PO convention <vendor name><date> (PNW9126 → PNW USA INC). (3) Still unclear → review, never a guess.
  Line names that are first names (Angie) count only with corroboration. "Worldwide" alone never
  decides (it is the billing route), and Worldwide Express (wwex.com) is never Worldwide Distributors.
  The Star of India vendor is to be renamed Angie Clothes; WWD bills it as STAR OF INDIA/ANGIE/NOSTALGIA.
- **"+ Add new…" inside every vendor and rep group picker** (small pop-up, prefilled from the email,
  picked on save) instead of separate buttons.
- **Freight**: carriers are their own kind: PartnerShip (parcel), ShipStation billed by Worldwide Express
  do-not-reply@wwex.com (parcel, PDF attached), Priority One (LTL only; anything @pinnacleteam.com is
  Priority One's scheduling/customer service, run by Dana's son Nick). All freight mail goes to Trevor
  (receiving and all things freight). A freight bill can cover several vendors: one line per shipper;
  the per-invoice fee goes to the biggest order (by wholesale cost) on that invoice.
- **Retail pricing at check-in**: freight % = freight ÷ product invoice; total % = 55% margin + freight %
  + 1.5% for WWD upcharge vendors; retail = item cost ÷ (1 − total %) (true margin: $5 at 66.5% =
  $14.93). Show the exact number, no rounding; Trevor edits any price. A summary line at the top shows
  freight %, margin, upcharge and total; when the freight bill is not in yet it says so and one click
  recalculates once it arrives.

## 2026-10-08 — Built the review-queue clean-up list (how it landed)
- Deleting from the Review queue: "Not a vendor, delete it" on cards about one vendor; never a vendor with
  orders. Deleted names are listed in Settings > Organization with "Allow again".
- One shared vendor picker everywhere a vendor is chosen in Review and Mail: "+ Add new vendor" first,
  inactive vendors grayed with "Reactivate and use". Rep group dropdowns have "+ Add new rep group".
- Contacts: `rep_group_contacts` (any number of reps; mail from any of their addresses or company domain is
  that rep group), vendor contacts may be phone-only, a star marks our assigned rep, orders have
  `taken_by`. The vendor form's single Rep fields are retired.
- Mail rules live in `supabase/functions/_shared/mailMatch.ts`; `scripts/rematch-mail.mjs` re-reads stored
  mail after a rule change. A web address naming a rep group (and no vendor) files to that rep group by
  itself; when it also looks like a vendor (Eagle Claw, Esco Trading/DandyLines) a person decides.
- Freight: `carriers` (owner Trevor), carrier mail tagged Freight in Mail and given to Trevor,
  `freight_bills` / `freight_bill_lines`. Worldwide Express PDFs are read by Claude (Sonnet: money on the
  page, about two cents a bill); PartnerShip bills wait for the PDF. Replies, reminders and meetings are
  not bills; PartnerShip's "- 792862" is its customer number, not an invoice number.
- Check-in pricing sits on the order page (Check-in pricing) until the check-in form is built: order lines
  typed or pasted from a spreadsheet, the summary line, exact editable prices, recalculate when the freight
  bill is matched. Reading the product invoice into lines comes with the confirmation check (plan §3, §6).
- Raelee and Cat need `places_orders` set when their logins are made at go-live.

## 2026-10-08 — Dana sees all freight while Trevor is new; freight bills are paid in VMS
- Dana: "Right now, since Trevor is still new, I want to see everything he is seeing." `profiles.sees_freight`
  (on for Dana): freight conversations show under her Mine and Mail for you (and the Mail count), and the
  dashboard shows Freight bills (to match, to pay). Trevor stays the owner. Settings > Mail > Freight
  switches it per person.
- Dana pays the bills: "Mark paid" on a freight bill (date, card / check / ACH / Bill.com, reference);
  Freight bills has a To pay tab, and the dashboard lists unpaid bills soonest due first, overdue in red.

## 2026-10-08 — One email, many vendors; Worldwide Warehouse; Marketing and Other
- Worldwide's mail (worldwidebuygroup.com) had been answered "PNW USA INC" by a slip on a review card: 164
  emails filed to PNW. Worldwide is now a service (each email files to the vendor it names); May's own PNW
  conversation stayed with PNW. The company-domain rule never files mail from services or carriers.
- Emails can be tagged to several vendors (`email_vendor_tags`; a vendor's Mail shows tagged conversations).
  Mail from services, carriers and rep groups is tagged to every vendor it names; Claude (cheapest model)
  reads the vendor names and any quoted freight rate in such mail from the last 90 days; "Also tag a
  vendor" on a conversation adds one by hand (with "+ Add new vendor").
- "Worldwide Warehouse" is the holding vendor for Worldwide portal orders until the invoice shows the real
  vendor ("Import Toys" was a Worldwide program, not a vendor; its order notes "WWD program: Import Toys",
  May Cheong per Sue). The warehouse's own address files to it. "Change vendor" on an order moves it,
  with its files and mail, to the real vendor.
- Dana: a Worldwide pallet's freight rate (Sue's 10.7%) is the freight % for each vendor on the pallet.
  Check-in offers "Use 10.7%" when mail about the vendor quotes a rate after the order date.
- "Who is this mail from?" gets Marketing (ads from a company we never bought from: always Offers &
  catalogs, no vendor) and "Other – not a vendor" (always Needs attention, given to Dana, waiting on us).
- Dana, Oct 8: Eagle Claw is a vendor, not a rep group; the empty "Eagle Claw" rep group is removed. Rep
  group pages have "Remove rep group" (vendors stay vendors without it, lines stay, its reps go, mail
  filed through it is asked about again).
- Dana, Oct 8: on "Who is this mail from?", "See the N emails" opens every email from the sender to read
  (attachments too). Tick some and file them to a vendor, or mark them Marketing or Other; the rest can go
  another way. Select all is the whole-sender answer (future mail too). The card closes when every email
  is handled; the sender stays undecided, so new mail from them asks again (`emails.disposition`).
- Dana, Oct 8: XPO (LTL, deliveryreceipt@xpo.com) is a freight carrier for Trevor. Claude reads each
  delivery receipt PDF: the shipper is the vendor, the PO finds the order. The email is filed to that
  vendor, the PDF goes into the vendor's and order's files as "Delivery receipt", and the order gets the
  delivered date as its received date when it had none. A receipt Claude cannot match goes to the review
  queue for the carrier's owner ("which vendor shipped it?"). Receipts are never freight bills. Works for
  any carrier's receipts ("Delivery Receipt", "Proof of delivery" in the subject) (`delivery_receipts`).
- Dana, Oct 8: freight carriers can be added and edited on the Freight bills page (+ Add carrier, the
  pencil on each carrier): name, parcel or LTL, email domains, website, account number, who gets its mail
  (Trevor by default) and Active. Saving claims the mail already in VMS from those domains (undecided
  senders only), so the carrier's bills and delivery receipts are read too.
- Dana, Oct 8: on the vendor page, Emails move up (right under Overview and Ordering windows) and the
  files become **Documents** at the bottom: folders Price lists, Catalogs, Invoices, Order forms, Show
  specials, Shipping (delivery receipts, packing slips, freight bills) and Other, each with a year folder
  inside, the way Dana files them ("Stansport/Invoices/2026"). The year is the season's year, else the
  date the file is for or arrived (`vendor_links.doc_year`); the folder follows the kind. Drop files on a
  folder or Upload (several at once, pick folder and year); Move changes folder and year; an email
  attachment's "Save to documents" asks the folder (guessed from the file name) and year.
- Dana, Oct 8: documents open inside VMS without downloading (PDFs and pictures as they are, Excel/CSV
  as tables with a tab per sheet, Word .docx as a page; nothing is sent elsewhere to show them; old .doc
  files download). The viewer has Download; each document has a download icon; a folder and each year
  have "Download all" as one zip (Vendor/Folder/Year/file). Email attachments open in the same viewer.
- Dana, Oct 8: **Bulk import documents** (Vendors page): drop whole vendor folders from Dropbox (or choose a
  folder). Each file is sorted from its path the way Dana files ("Stansport/Invoices/2024/…"): the vendor is
  the first folder name matching a VMS vendor or alias, the folder and year come from folder names, then the
  file name, then the file's date. "Ask Claude" reads the rest (the path, and PDFs and pictures themselves,
  on the cheapest model; `docs-sort`). Nothing is filed until a person has seen the list: unsure rows wait
  under "Need a look" (Claude's unsure answers too, until "Looks right" or a change); files already in VMS
  (same vendor, name and size) are skipped; 25 MB per file. Imported documents have source 'import' and
  "Imported from <path>" in their notes. Reorganizing Dropbox itself waits on a Dropbox connector.
- Dana, Oct 8: a conversation shows the newest email first, open; older ones are closed to one line
  (who, date, first words) and open on a click.
- Dana, Oct 8: the Vendors page search box is full width on its own row (the filters had squeezed it to a
  sliver) and the list narrows as you type, no Enter. Other list search boxes keep a minimum width.
- Dana, Oct 8: on the vendor page, Documents sit right below Overview (and Ordering windows), above Emails.
- Dana, Oct 8: in an email, the real attachments are listed at the top (signature logos and small pictures
  fold into "+N images") and the quoted earlier emails fold under "Show earlier messages in this email".
- Dana, Oct 8: the search bar at the top drops down matching vendors as you type; click or Enter opens the
  vendor; the last row searches everything.
- Dana, Oct 8: "Harbor Freight is not a vendor, it's a shipping carrier." HARBOR FREIGHT (from Lightspeed,
  no orders) was deleted and its name excluded from imports; Oak Harbor Freight (OAKH, LTL) is a carrier.
  Its mail was filed again without it.
- Dana, Oct 8: "Needs an answer" only holds email that needs one. Claude (cheapest model) reads the newest
  email of each conversation waiting on us: sure no reply is needed (tracking updates, delivery notices,
  automatic invoice notices, receipts, ads, "thanks") → Handled; a question or request → stays; **not 100%
  sure → a "Does this need an answer?" card in the review queue** for the conversation's owner (Needs an
  answer / No answer needed). Three "No answer needed" about one sender and its unsure emails go to Handled
  (a real question still stays). Marketing senders go to Handled without asking. A carrier's status update
  shows on the conversation (Delivered, In transit…) and is filed to the shipper (Origin), never to a name
  in the text. The conversations already waiting are read the same way, 30 a minute.
- Dana, Oct 8: a fourth billing route, **Prepaid Direct** (paid up front, directly), with how it is paid:
  credit card or ACH (`vendor_billing_routes.pay_method`), shown on the route badge ("Prepaid Direct · ACH").
  Orders can be paid via ACH.
- Dana, Oct 8: the "Lightspeed department" review rule is now **Lightspeed category**, with subcategories:
  type and pick from the departments and categories on file ("Camping", "Camping/Coolers"). A top level
  covers its subcategories; the most specific rule wins. It matches the department or category a review
  names and the vendor's own categories. Adding a rule puts "who orders from it" cards in the review queue
  for that category's vendors nobody orders from yet (Jarrett: Sunglasses, Knives, Hunting, Camping).
- Dana, Oct 8 (keeping tabs while the staff learns):
  * Mail list: a ✓ on each conversation marks it handled without opening it; checkboxes mark several at once;
    Undo for a few seconds.
  * "Working on order" on a conversation puts it on that person's dashboard card "Orders I'm working on";
    the list shows Needs an answer (the rep wrote last), Waiting on rep (we wrote last), Working (set by hand),
    Completed (done; it offers "Add order from this email").
  * Admins get a "Showing" switch (Me / Everyone / one person) in the top bar; the dashboard, Mail, Review
    queue, Vendors and Orders follow it, with a colored bar while it is not "Me". Staff always see their own.
  * Team page (admins): per person, Needs an answer, No answer yet, review items, working on, vendors, last
    email sent; red when something has waited more than 3 days (days off allowed). Numbers open that
    person's list.
- Dana, Oct 8: a **Credits** folder right next to Invoices in a vendor's Documents (credit memos, credit
  notices, return authorizations). Saving from email, bulk import and Claude's sorting all know it; files
  already filed as invoices whose name says credit moved there.
- Dana, Oct 8 (freight payments): a bill is marked paid from a carrier's payment receipt (Claude reads the
  PDF; the receipt is kept on the bill) or from our own email saying it is paid ("This order was paid by ACH
  10/8/26 by Dana"). The bill is found by invoice number, else the bill that conversation is about, else the
  only unpaid bill of that carrier for that amount; otherwise a "which bill?" card in the review queue for
  the carrier's owner. "Not paid" on the bill undoes it. Any PDF in an email has a "Freight bill" button
  (bills that came some other way). Freight bills are filed with the carrier (Freight bills page; click a
  carrier for just its bills, every year, paid or unpaid) and, once a line is confirmed, with the vendor
  (Documents → Shipping) and now the matched order too.
- Dana, Oct 8: handled mail leaves every Mail tab (Needs attention, Offers, Freight, All); it stays under
  "Handled", on its vendor's page and its carrier's. "Mark handled" in a conversation goes back to the list.
- Dana, Oct 8: when UPS is added as a carrier it is **"UPS DIRECT"**: the company's own UPS account, no
  longer used for new shipments because Worldwide Express (WWEX) prices UPS shipments much better. Both are
  UPS, but different account numbers and billing; old UPS Direct invoices are history (2026 catch-up).
- Dana, Oct 8: our UPS account number through each billing company shows on the Freight bills page (each
  carrier card, each bill): UPS DIRECT 89787W (our own account, no longer used), PartnerShip V513K4 (used
  earlier in 2026), Worldwide Express 2K229F, **the default UPS (parcel) shipper**. WWEX's W0003290195 is
  our account with them, a different number. UPS DIRECT was added as a carrier (no email domain yet).
- Dana, Oct 9: **billing companies** (we book and pay: Priority One, PartnerShip, Worldwide Express / WWEX /
  ShipStation, UPS DIRECT, Worldwide Distributors) are separate from **trucking companies** (haul it, hired
  by a billing company: XPO, Oak Harbor Freight). Bills belong to billing companies; trucking companies'
  tracking and delivery receipts are still read. WWD is a billing company: its freight bills come from the
  WWD portal (Trevor uploads them); warehouse@worldwidebuygroup.com and everyone in the WWD directory's
  Warehouse department write WWD freight mail (Freight tab), still filed to the vendors it is about.
- Dana, Oct 9: **Delete** mail: on a conversation, and for ticked rows in the Mail list. It moves the
  conversation to Gmail's Trash for orders@ (30 days) and out of every VMS list; the **Deleted** tab shows
  who deleted what and when, with Restore. Anyone who answers mail can delete. Files already saved stay. A
  new message in a deleted conversation brings it back.
- Dana, Oct 9: **Upload bills** on the Freight bills page: drop a batch of bill PDFs (PartnerShip, UPS DIRECT,
  WWD, WWEX). Claude reads each, including the billing company and our UPS number printed on it, which picks
  the billing company; a bill already waiting for its PDF (PartnerShip emails) is filled; a bill already on
  file is skipped; an unknown company asks on the bill. PartnerShip's invoice emails now give the invoice
  number, dates and amount (the 12 waiting bills were filled in from theirs).
