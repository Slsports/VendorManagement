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
- Dana, Oct 9: **Payments** page imports Bill.com's Payments export (Excel or CSV). Each payment is matched
  to a freight bill (billing company + invoice number, else the only unpaid bill for that amount) or a vendor
  order (invoice/PO number, else the only unpaid order for that amount) and marked paid via Bill.com with
  the confirmation number; unmatched ones are kept as history. A preview comes first (untick rows); a
  payment already imported is skipped. Each vendor page lists its payments.
- Dana, Oct 9 (idea for next week, not built): **freight routing follow-through**. When we switch who we ship
  through (now WWEX, UPS 2K229F), every vendor gets a new freight routing letter (Dana will write it) and must
  ship on our UPS number or ask us for a pickup. VMS should track that each vendor got the letter and then
  followed it: the account inside each UPS tracking number (1Z + 6-character shipper account) shows whether a
  shipment went on our number, on the vendor's own account billed to us, or the old account.
  Also waiting: 792862 as our PartnerShip account number (Dana to confirm); the scanned-paper invoice import.
- Dana, Oct 9: PartnerShip bills show no UPS number of ours, only "PartnerShip Account # 792862": saved as our
  account with PartnerShip. Uploaded bills now match a billing company by our UPS number or our account
  number with them, then by name. (UPS tracking numbers carry the shipping account: 1Z + 6 characters.)
- Dana, Oct 9: **scanned paper invoices** (back to 2010) in Bulk import: tick "Scanned paper" and Claude
  (the capable model) reads every page of each PDF, splits a stack into its documents (one file each), and
  gives each its vendor, folder (Invoices, Credits, Shipping for packing slips…), number, date and total;
  the date sets the year folder; faded, handwritten or unclear pages stay under "Need a look". A document
  keeps its number, date and total (`vendor_links.doc_number/doc_date/doc_total`), and each vendor's
  Documents has a search box (number, amount, name). Scans up to 30 MB per file.

## 2026-10-09 — WWD payments, the Placed Order Summary v2.0, freight allowances
- Dana: Worldwide's portals never show the whole picture. The **Payment History** export (PB payment numbers,
  dates, totals, the WWD invoice numbers paid, back to 2019) has no vendor names; the **EdenRed** invoice
  export (Nov 2025 on) has WWD's sequence number with our PO, the vendor, the vendor's own invoice number,
  amount, terms and due date; Dana's own **payment sheets** (pasted from the pay screen as she pays, 2024 on)
  have the vendor per WWD number. "Check #" in WWD is not a check: we pay online by ACH; VMS calls it the
  **WWD payment #**.
- Payments page has a **WWD box**: drop any mix of those files (Excel, the History "xls", Word copies of the
  sheets, or scans/photos of printed sheets, which Claude reads). Preview first, then Import; importing a
  file twice adds nothing. Each WWD number is one invoice in VMS (a credit or debit reuses the number of the
  invoice it adjusts, so it takes that invoice's vendor and order). The **$275 lines are WWD's monthly
  membership fee**, filed under WORLDWIDE. Vendor names match VMS names and aliases (also "starts with the
  VMS name", e.g. "Daisy Outdoor Products" = DAISY); names VMS cannot place are listed under **WWD names to
  match**: pick the vendor once and the name becomes an alias. Invoices tie to orders by our PO, else the
  vendor's only order for exactly that amount; an order whose WWD invoices are all paid is marked paid via
  WWD with the PB number. Vendor pages and order pages list their WWD invoices (WWD #, their invoice #, PO,
  amount, discount, paid date and PB #); on a vendor page an invoice can be tied to another order or untied.
- First load (Oct 9): 2,501 WWD invoices and credits, 292 payments (Apr 2019 to Sept 15, 2026), 875 with a
  vendor (852 of them since 2024), 512 orders tied to their WWD invoices, 82 orders marked paid with the PB
  number. The 10/8/26 $96,778.41 payment is in from Dana's sheet (paid date 10/8/26); its PB number arrives
  with the next Payment History export. 1,593 older invoices have no vendor name anywhere (before the sheets
  start) and stay on file by WWD number. Payment sheets missing for good: 9/3/24, 9/26/24, 6/24/24
  (Dana: 6/24/24 was Diversified (SLM), filed so); 4/7/25 ($227.53, #5887965) still open. 12/3/24 was Terramar Sports 5875952 ($431.66 less
  $8.63, from Dana). Dana's 12/27/24 unnamed credits: #6915243 = Continuum, #5871877 still unknown.
  "NORMARK CORP / RAPALA" set to RAPALA - NORMARK by hand (LUHR JENSEN carries an alias "Rapala" that pulled it).
- **Placed Order Summary v2.0** loaded, tabs 1-4 only (Dana): 1,069 rows matched orders already on file from
  the Buying Guide and refreshed, 200 new orders, 3 new vendors (BASIC SPIRIT, KASTKING, TOPHAT CRICKET FARM).
  Rows the sheet lists twice count once. A second run of the first version added 8 doubled orders and a
  stray "MASTER FISHING" vendor; they wait on Dana's OK to be removed (the importer no longer does this).
- **Freight allowance** (Dana): some vendors credit the freight back when the invoice is paid on time (Water
  Sports, Continuum, Schylling, Marky Sparky, Master Fishing "1/2 freight allowance"). An order can carry the
  allowance (amount if known, pay-by date); the dashboard lists unpaid ones soonest first, red in the last
  week; a WWD credit on the order marks it received. The vendor form has "Credits the freight back when we
  pay on time" so their orders show the reminder. Set from the sheet notes on 9 orders and 6 vendors.
- Dana, Oct 9: **one place for every WWD payment**: Payments page "WWD payments", newest first, sortable by
  date, WWD payment #, vendors, discounts and amount; click a payment to see each vendor paid (WWD #, their
  invoice #, invoice amount, discount, credits, the membership fee) and the total. A payment known only from
  Dana's sheet shows "From your sheet" until the Payment History export brings its PB number. (The 10/8/26
  sheet adds up to $96,347.48 paid: $98,778.41 of invoices less $2,430.93 discounts; the file name says
  $96,778.41.)
- Dana, Oct 9: in "WWD names to match" a name **opens to show its invoices**, and a name can be a **freight
  company** (XPO is a trucking company, not a vendor). Freight lines are filed to the company and also need
  the vendor whose goods were carried ("Freight to tie to a vendor"); VMS fills it from the XPO delivery
  receipt with the same PRO number when there is one. Freight companies learn WWD spellings like vendors do;
  "XPO Logistics Freight, Inc" and "XPO SHIPPING" filed themselves to XPO (9 lines).
- Dana, Oct 9: **after sending a reply** VMS goes back to the list you came from (the inbox); a forward or
  a new message stays on the conversation. **Pictures in emails** (price photos, signature logos): a message
  with pictures opens formatted, each picture back in its place in the text (Gmail's inline cid: images
  are filled in by gmail-read); "Plain text" still switches back.
- Dana, Oct 9: **Snooze** an email conversation or a review item: later today (3 hours), tomorrow morning,
  in 2 days, next Monday (mornings are 8 am) or any date and time. A snooze is the person's own: it leaves
  their mail lists, review queue, dashboard and Mail count until the time, then comes back at the top marked
  "Back from snooze" (cleared when the conversation is opened; on a review item until it is settled). A
  vendor reply ends a conversation's snooze at once. Mail has a **Snoozed** tab (mine, or everyone's with
  who and until when) and the review queue a **Snoozed** button; "Unsnooze now" from the same menu. Mail
  rows and ticked rows can be snoozed from the list.

## 2026-10-10 — Vendor ID in item names: per vendor, per order, per item
- Dana: the Vendor ID at the end of an item description helps for some vendors and gets in the way for
  others. Each vendor has **"Add Vendor ID to item descriptions"** (off unless set); an order can change it
  before its PO is made (checkbox on the order, pre-set from the vendor); one item can differ from its order
  (the [ID] tag on the line). When on, the name ends with the Vendor ID in brackets:
  `MENS HOODIE NAVY [AB1234]` (never added twice). The Lightspeed clean-up's rename proposals follow the same
  setting; nothing changes in LS without an approved batch.
- Dana, Oct 10: **Artwork approvals.** Claude reads each incoming vendor email (not ads, carriers or "not a
  vendor" senders): is the vendor waiting on us to approve artwork, a proof, a mockup or a design before the
  order goes ahead? Yes → the conversation goes to the art approver (Dana: `organizations.settings.
  art_approver_id`, else the admin), even when someone else handles that vendor, and onto the dashboard card
  "Artwork approvals" (vendor, subject, days waiting, red after 2 days, link to the email). Unsure → an
  "Artwork to approve?" review card for her. On the conversation: Approved / Needs changes (stays on the card
  until the next proof) / Not artwork, and "Artwork to approve" to add one by hand. Our own reply saying it is
  approved closes it; asking for changes marks Needs changes. The first run reads the last 60 days of mail.
- Dana, Oct 10: **orders can be edited**: an Edit button on the order opens every date and detail the sheet
  tracks (ordered, ship, received, entered in LS, terms and due, paid date/via/reference, costs, freight,
  credits, notes), Save pinned at the bottom. Fixed from mail and WWD records: Scope PO 1132 ordered
  6/28/2024 (the sheet said 2029; shipped, received 6/29/2024, paid 7/10/2024), and six World Famous Sports
  shipments of show PO B671437 dated 12/31/2025, 12/31/2026 or blank set to the show order date 8/26/2025.
  A re-import of the Placed Order Summary takes the sheet's dates again, so the sheet should be fixed too.
- Dana, Oct 10: **a re-import keeps what was changed in VMS.** Every order field the sheet also carries
  (dates, costs, PO, notes, status, payment…) remembers when it was changed in VMS (`orders.edited_fields`,
  set by a trigger); the sheet imports run with `vms.import = on` and leave those fields alone, updating
  the rest. The Oct 10 date fixes (Scope, World Famous B671437) are marked, so the sheet need not be fixed.
- Dana, Oct 10: **artwork approvals count only delivered artwork**: the email itself carries the proof,
  mockup or design (attached, pasted or linked) for us to approve or pick from. Promises ("I'll mock
  something up"), offers, requests for our logo or a vector file, color options and product photos do not
  count; an email with nothing but signature logos cannot be one. Everything flagged before was read again
  under this rule (approved ones kept).

## Oct 10 — Artwork: "Needs changes" means Dana still has something to do
Dana: on Ace's Ali Hammer proof she clicked Needs changes and it read as waiting on the vendor, but she
hadn't sent anything yet. Now there are four steps: **Waiting on approval** → **Needs changes** (on her
Artwork approvals card as "Changes to send", counting days, red after 2) → **Changes sent** (her button, or
set on its own when our reply asks for changes; listed last in grey, "waiting on a new proof") → a new proof
from the vendor puts it back to Waiting on approval. Approved closes it. Migration 0076.

## Oct 10 — Click a sender to see all mail with them
Dana: "click on the name of the 'from' email and have it bring up all my emails with them in chronological
order newest to oldest." On a conversation, the sender's name (and outside To/Cc addresses) opens **Mail
with** (/mail/with): every email from, to or copied to that address, newest first, sortable by its headers,
each row opening its conversation. "Everyone at this company" widens it to the whole address ending
(@acme.com), not offered for Gmail, Yahoo and the like. Our own addresses are not links. Migration 0077.

## Oct 10 — Order paperwork: four documents, two checks, the person who placed the order looks
Dana: "Confirmations are not invoices so they definitely need their own folder." Four documents to an order,
each with its own vendor folder: **Our orders**, **LS POs**, **Confirmations**, **Invoices**. The order page
shows the four with a tick when on file.
- A vendor's confirmation or invoice attached to their email (last 30 days going in) is saved to that folder
  for the year; a confirmation or invoice uploaded or saved from an email does the same. Old files from the bulk
  import, or dated more than six months back, are filed without a check.
- **Check 1, confirmation vs. our order:** Claude reads it, finds the order (PO number, else the vendor's one
  open order, else the one within 3% of the total; else asks "Which order is this for?"), and compares it with
  our order or LS PO on file, else the PO we emailed from orders@ (saved to Our orders), else the order record.
- **Check 2, invoice vs. confirmation:** compared with the final confirmation for the order.
- Each check is a summary (green when everything matches) with every item and field compared and, with issues,
  an email Claude drafted to the vendor. It goes to **whoever placed the order** even when clean: Jarrett's
  orders to Jarrett, everything else (Dana, "D&J", people no longer here) to Dana. "Looked at by" hands it to
  anyone else. Dashboard card "Confirmations & invoices to review". Nothing is sent until that person edits and
  presses Send; marking a confirmation looked at sets the order to Confirmed.
Migrations 0078–0079; Edge Function order-check runs every minute.

## Oct 10 — "Hi Jarrett" routing, picture previews, Images folder, "Saved to" tag
- An incoming email whose greeting names one of us ("Hi Jarrett", "Dear Dana") goes to that person's mail, even
  when the vendor is normally someone else's. Claude reads the greeting with the reply check; "Hi all" or no
  name keeps the usual rule. Migration 0080.
- Picture attachments show a small preview in the email; click it to open full size.
- Vendor documents get an **Images** folder (photos, artwork, logos); pictures saved from email go there unless
  their name says otherwise.
- A file already filed shows "Saved to Confirmations › 2026" (its folder and year) instead of Save to documents.

## Oct 10 — Item pictures saved to Images; Approved proofs folder
Dana: "If a vendor sends images of items they would go in that folder" (Images), including the past 12 months.
Real pictures in a vendor's email (60 KB+, not logos, icons or signature pictures) are saved to that vendor's
Images › year; the same picture sent again is saved once. Artwork proofs stay in the email: artwork
conversations are skipped, and a new **Approved proofs** folder holds the final proof, saved by hand once it is
approved ("we will click to save in that folder"). Migration 0081.

## Oct 10 — Moving files; file buttons in words
Dana: "I need to be able to move a file to a different folder if Claude puts it in the wrong one" and the
icons were "too far over". Each file in a vendor's Documents now has **Open · Download · Move · Remove** right
under its name, at any screen width. In an email, the green "Saved to Images › 2026" tag opens the same Move
box. Moving a file into Confirmations or Invoices starts Claude's order check; moving it out sets its unfinished
check aside. Migration 0082.

## Oct 10 — Picture previews in folders; rename files
Dana: "make anything that is an image in a folder show a preview of the image and I can click on it to enlarge
it" and "I also want to be able to rename them". Pictures in any vendor folder show a preview (click to open
it large); the Images and Approved proofs folders show them as a grid of large tiles. Every file has
**Rename** beside Move: it changes the name shown in VMS, not the file.

## Oct 10 — Damaged Items folder
Dana: "I see images of damaged items which we would use to attach to a vendor return email. So let's call it
Damaged Items." New vendor folder **Damaged Items** (shown as picture tiles). Pictures from a vendor email whose
subject talks about damage, defects, breakage, a wrong item, "order issues" or a return go there instead of Images; the 21 already saved
(Image One, Norty, Water Sports, World Famous Sports, Planet Cotton) were moved. Migration 0083.

## Oct 10 — New VMS logo; forest green replaces #00B050
Dana picked a pin logo ("tracking is the biggest asset"): an amber pin on forest green. Two editions in
`public/brand/`: **sls/** with the SLSI fish in the pin (the fish's eye redrawn as the original "sly eye":
almond eye, lid line corner to corner, pupil in the back corner looking at you) and **vms/** with "VMS" in the
pin for white-labelling. The favicon is the plain pin with a V for both. Dana: "Final assets should match the
forest green in the new logos," so organization #1's accent moves from #00B050 to **#2F6B4F**. No gray anywhere:
shadows under the pin are amber with a green core on light backgrounds, an amber glow on dark ones. The sidebar
uses the pin alone (`logo-mark`), since the app name already sits beside it. Migration 0084.
Guide: `docs/brand-assets.md`.
- **Sign-in page:** the pin beside **Shaver Lake Sports** (no "Inc.") in large bold print with **Vendor Management
  System** under it, spread letter by letter to the same width without a bigger font ("We nailed it!"). The two
  lines are nearly as tall as the pin; no "RetailHQ". On phones and iPads held upright it sits centered right above
  the white sign-in box (Dana: "most of my people will be on iPads or phones").

## Oct 11 — Each person orders their own dashboard
Dana: "Is it possible for each ee to have the ability to see the dashboard in different order of cards?" —
go. **Customize** on the dashboard lists the cards with up/down arrows and a tick to show or hide each; it is
saved to that person's login (profiles.dashboard_layout) and follows them to any device. "Reset to the standard
order" clears it. Cards added later appear after their own. The key-figure tiles at the top stay as they are.
Migration 0085.

## Oct 11 — Personal mailboxes and the old Gmail
Dana: personal inboxes for Dana, Trevor and Jarrett ("private from everyone except admin"), Claude reads them for
documents like orders@; the old shaverlakesports@gmail.com forwards to **oldslsgmail@shaverlakesports.com** (an
extra address on orders@) and shows as Dana's "Old Gmail" feed, seen only by her.
- `mailboxes` table (personal / legacy); `mail_accounts` stays the one shared orders@. Threads and emails carry
  `mailbox_id` (null = orders@); emails carry `gmail_box`, the Gmail mailbox their ids live in.
- Privacy by RLS: owner and admin only, or everyone once **Share to Orders** is pressed on a conversation. Private
  mail adds no senders and no review cards (subjects and snippets would leak); its conversations always belong
  to the mailbox owner; the team page counts Orders mail only.
- Mail page: Orders (shared) / My mail / (admin) everyone's and Old Gmail. New email: From orders@ or me.
  Replies go from the conversation's mailbox; only the owner sends from a personal one.
- The same email in orders@ and a personal inbox: the second copy is marked (copy_of) and Claude's file steps skip it.
- Personal mailboxes loaded their last 90 days. Old Gmail: from when forwarding is turned on; its past year can be
  pulled in later with a one-time sign-in. Migration 0086.

## Oct 11 — Emails open formatted; live links
Dana: "I want formatted to be the default" and links were not clickable. Every email now opens in its formatted
version (plain text shows while it loads, or when there is none; "Plain text" still switches). In plain text, web
addresses are links (new tab) and email addresses start a new email in VMS.

## Oct 11 — Whole dashboard customizable; overdue and future-dated orders split
Dana: "I want everything customizable" and "Overdue orders and Future-dated orders to be separate cards".
Customize moved to the top of the dashboard and now covers the number boxes at the top too (reorder, hide),
saved per login with the cards. The combined card became two: Overdue orders and Future-dated orders.

## Oct 11 — Create an order from "Does this need an answer?"
Dana: "a create an order button" on the review queue's "Does this need an answer?" cards. The card now has
**Create an order**: the add-order form for the email's vendor, linked to that email. If the email is not filed
to a vendor yet, it says so (file it first).
- Same day: "Please make all cards eligible to be on top." Number boxes and cards are now one list in Customize:
  anything can go anywhere, top included. Neighbouring number boxes still share a row of four.

## Oct 11 — Dashboard boxes show a count; click for the list
Dana: "each box show a count and when we open it we see all the items … the cards should not show any data
except for the number of items in it. When you click it, the list appears." Every dashboard card and number box
now shows only its name and count (red when something is late); clicking opens the list across the row, and
again closes it. The order boxes are live: Open orders, Overdue orders (not received, 30+ days past ship date),
Payments due (entered, not paid), Future-dated orders (shipping 30+ days out); each opens its orders, with a link
to the same list on the Orders page (?view=). The duplicate Overdue / Future-dated cards are gone.

## Oct 11 — Sales reports folder; first reports filed
Dana uploaded her Sales Report Formatting Spec v49 (now `docs/sales-report-spec.md`) and an LS Analytics export
holding two vendors: "separate them into separate sales reports and attach to their individual vendor record".
Vendor documents get a **Sales reports** folder (kind sales_report). Filed: DP_10-11-26_PARICON_SALES 365 DAYS
(17 active, 2 no-data, 9 ignored archived) and DP_10-11-26_SLIPPERY RACER_SALES 365 DAYS (37 active, 4 no-data;
grouped by product line per Step 7, with a TYPE Size Summary). Report period assumed 365 days (the spec's default).
Order statuses on the Ordering card (to build): Check stock, To order, Placed orders (sent, no confirmation),
Confirmed orders, Overdue; the suggested order subtracts what is already coming in. Migration 0087.

## Oct 11 — DKIM and DMARC on for shaverlakesports.com
Dana turned on DKIM in Google Admin (google._domainkey TXT in GoDaddy) and added `_dmarc` = `v=DMARC1; p=none;
rua=mailto:dana@shaverlakesports.com`. SPF already `v=spf1 include:secureserver.net include:_spf.google.com ~all`.
Next: after 2–4 weeks of clean DMARC reports, move to `p=quarantine`; remove Microsoft leftovers (the lync SRV
record) once Microsoft is retired.

## Oct 11 — Tasks
Dana: "in vms we need a task list that we can add things we need to do … a date, to do item and when you want to be
reminded and the ability to tag it to a vendor, freight co, or something else … and I could assign it to someone
else." Then: reminders "on dashboard & email is default, but in setting they can select dashboard, email or text …
one, two or all three"; "each person sees theirs, but I can switch to see their view"; repeating tasks now, with a
custom option; and a + on the task box to add one.
- A task: what, due date, remind me (date and time), assigned to (default me), about (vendor, freight company, rep
  group, order, email, or any text), notes, repeat (none, every week / month / year, or custom: every N days, weeks
  on chosen weekdays, months or years, until an optional end date). Finishing a repeating task makes the next one,
  reminded the same time before it is due; late finishes skip dates already gone.
- Each person sees tasks assigned to them and the ones they gave; Dana sees everyone's and anyone's with "Showing".
- Tasks page (nav, Overview): My tasks / Given to others / Done, sortable, with "How I get reminders" (dashboard,
  email, text, any mix; default dashboard + email; a cell number for texts). Dashboard "My tasks" box (count, red
  when one is late, + to add); reminders whose time has come show at the top of the dashboard (Done, Later, Dismiss).
  "+ Task" on vendor, order and email pages, with the open tasks about them.
- When someone finishes a task another person gave them, the giver is told (dashboard, and email/text as they chose),
  with an optional note.
- Reminder emails come from orders@ as "VMS Reminders" (header X-VMS-Notice, so they are never filed as mail).
  Texts need a texting service (Twilio: TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM function secrets); until
  then a text reminder is skipped and the task says "not all sent". Migration 0088, function task-reminders (every
  minute).

## Oct 11 — Reminder button "Dismiss"; Help (Knowledge Base)
Dana: the dashboard reminder's "Got it" is now **Dismiss** (hides the reminder; the task stays open).
Dana: "create a complete list of features and exactly how to use them as help files so someone could search the
Knowledge Base to learn how to do things … add and edit this every time we make an update." VMS gets a **Help** page
(menu → Help, everyone including invoice uploaders): search box across all articles, or browse by topic; each article
is one "how do I…" with steps and "Good to know". Articles live in `docs/help/` and ship with the app, and every
session updates them in the same change as the feature (rule in CLAUDE.md).

## Oct 12 — LS PO comes after the confirmation (Ordering card, to build)
Dana: the LS PO is created "after its been confirmed", so it matches what the vendor is shipping. On the Ordering
card, a confirmed order with no LS PO is marked "LS PO needed" until its PO number is typed on the order or the LS PO
file is saved to its LS POs folder. Once LS is connected, the order gets "Create PO in LS": VMS builds the PO from
the confirmed lines, Dana approves it, VMS sends it and saves the PO number back.

## Oct 12 — Ordering card built (Dana: "Go on all of it")
- Dashboard **Ordering** card with six counts: Check stock, To order, Placed (sent, no confirmation), Confirmed,
  Overdue (confirmed, 30+ days past ship date, red), LS PO needed (confirmed, no LS PO number or document, amber).
  It replaces the Open orders and Overdue orders boxes; Payments due and Future-dated stay boxes.
- Flags **Check if we need it** / **Remind me to order** on the vendor page (new Ordering box) and on "Does this need
  an answer?" cards (they replace that card's "Create an order"). Who handles it starts as the vendor's assigned buyer.
- **Upload sales report** on the vendor page: VMS reads the raw LS Analytics export, formats it per spec v49 in the
  browser (same tabs and look as the reports made by hand on Oct 11), files it in Sales reports and keeps the items.
  Apparel gender/size grouping (spec steps 1–6) is not automatic yet.
- **Suggested order** = Need (sold − in stock) minus what is coming in: confirmed orders (confirmation lines),
  shipped/received not yet entered in LS (invoice lines), placed orders (our order lines), matched on Vendor ID. On
  order column names each order and its ship date; open orders without item lists are named to check by hand.
  Quantities can be changed; **Order placed** opens the order form filled in (lines included) and closes the flag.
- Orders get an **LS PO** number box; the LS PO is made after the confirmation. Migration 0089.

## Oct 12 — Sign in with Google and the staff list (Dana: "go")
- Nick's suggestion: everyone signs in the same way through Google, no VMS passwords to manage. Dana: yes.
- Login page gets **Sign in with Google**. Any Google account works (Tyler and Greg do not have @shaverlakesports.com
  addresses), but only an email already on the staff list gets in: sign-ups stay off on the project, so an unknown
  Google account is refused with "not on the staff list, ask Dana". Password login stays as the backup for everyone.
- **Settings → Users** is the staff list: add a person (name, email, role, stores), change role, stores, deactivate,
  send a set-password email. Roles offered: manager, buyer, viewer, uploader. Admin is never offered; only Dana is admin.
  Adding a person creates their login through the `admin-users` Edge Function (admin-only). Existing logins
  (Trevor, Jarrett) link to their Google account on first Google sign-in because the email matches.
- Dana's own VMS login is billing.slsports@gmail.com, so her Google button works with that Google account, not with
  dana@shaverlakesports.com, unless she asks to switch her login email.
- Dana's side: create the Google sign-in credential in Google Cloud (Sonnet prompt) and switch on the Google provider
  in Supabase. Nothing in VMS changes until then; the button shows an error from Google.

## Oct 12 — Dana's VMS login is dana@shaverlakesports.com
- Switched from billing.slsports@gmail.com (same profile, same password). Dana is moving her Supabase, Vercel and GitHub
  account emails to dana@ as well; Claude stays on billing.slsports.

## Oct 12 — "Working on" joins the Ordering card
Dana: the Ordering card and the "Orders I'm working on" card overlapped. The emails flagged "Working on order" are now
the **Working on** count on the Ordering card (between To order and Placed, with how many need an answer); the separate
dashboard card is gone. The full list page stays (Open the full list, and the Team page link to it).

## Oct 12 — Pay-by reminders replace the Freight allowances card
Dana: "Pay on time for freight back is not a necessary card, it should just flag the dashboard as a to do … We also
have other discounts we get if we pay earlier than the due date." Dana is the only one who pays; reminders 5 days
ahead. VMS keeps one task per bill, assigned to the admin, due on the pay-by date: WWD invoices with discount terms
(best tier still open, then the next, then the net due date), orders with discount terms in AR due (no WWD invoice),
and freight back for paying on time. Tasks close themselves when the bill is paid; checking one off by hand ends
reminders for that bill. Hourly (pg_cron payment-tasks). First run made 21 tasks (Oct 14 – Jan 13). Migration 0090.
The Freight allowances dashboard card is gone; the order's Freight allowance box stays.
- Same day: Dana wants every early-pay discount reminded, however small (no minimum).

## Oct 12 — "New version ready" bar
Dana's iPad kept an old copy of VMS (signing out does not reload the app). VMS now checks every 5 minutes and when the
app comes back into view whether a newer version is live, and shows a green bar "A new version of VMS is ready. Tap
here to refresh." at the top.
- Same day: the Ordering card always spans the full dashboard width (seven counts side by side; two rows on phones).

## Oct 12 — WWD payment 10-8-26 posted; payment sheets count as paid for reminders
Dana's sheet "10-8-26_WORLDWIDE_PAYMENT_96778.41": 58 invoices ($98,778.41 invoiced, $96,347.48 after $2,430.93 in
discounts), all already in VMS, marked paid 10/8 from the sheet. Pay-by reminders now treat a payment-sheet date as
paid (like Payment History and EdenRed): 20 of the 21 closed as Paid; Rapala (Jan 13, 6%) stays. Motormax Toy Factory
is not matched to a vendor yet. Migration 0091.
- Same day: Motormax Toy Factory added as a new vendor (WWD route; ships out of WWD's warehouse) and WWD invoice 1786001 ($120, PO IMPORTTOYS-2-1-26) filed to it.
- Same day: WWD only posts an invoice to pay once it has shipped to us (Dana). Lanard Toys 1787024 ($114.48) also carries PO IMPORTTOYS-2-1-26; the parked Import Toys order waits on Trevor's check of that pallet (ask Dana Tue Oct 13 pm).

## Oct 12 — LS POs drafted by Claude, approved by the orderer, reviewed by Trevor
Dana: "Once an order is marked as Placed (confirmed), Claude should create the PO and send it to the person who
ordered it. Once they approve it, it goes to Trevor who will review the naming conventions, etc and send it to LS."
- A confirmed order starts an LS PO draft. order-check (every minute) builds it from the vendor's confirmation (else
  our order's lines); items matched to LS by Vendor ID/UPC in the vendor's latest sales report keep their LS name and
  category; Claude (Sonnet) names new items per the LS category standard (docs mirror in _shared/lsStandard.ts).
- To approve → the person who placed the order (Jarrett's orders to Jarrett, else Dana); To review → the LS PO reviewer
  (Settings › Organization; Trevor ticked); Send to LS → until LS is connected, Download for LS / Print, enter it,
  type the LS PO number (saved on the order). Each step is a task for that person.
- Ordering card: the LS PO box sits after Confirmed (replaces "LS PO needed"), with how many wait on you.
  Migration 0092.

## Oct 12 — Orders we email to vendors become orders
Jarrett's Mack's Lure early-buy order (9/23, order writer attached, PO MACKS092326) was in Mail but never an order, so
its confirmation (#90351) waited for an order. Dana: "Go and definitely scan the email too". New function sent-orders
(every minute): Claude (Haiku) sorts our sent Orders mail (12 months back, then new) for emails that place an order;
Claude (Sonnet) reads the email text and attachments (PDF, picture, order writer spreadsheet as text); the order on
file (same PO, else same vendor ±5 days and total) gets the email, file (Our orders) and lines; otherwise a new Open
(Placed) order, placed_by from the signature. Sent more than 120 days ago and not in VMS: listed only
(emails.order_scan = old_not_in_vms) for Dana. Confirmations waiting for an order are matched again
(order_checks_refind). Private mailboxes are not read unless shared to Orders. Migration 0093.

## Oct 12 — How vendors must address us (Dana)
- Name: "Shaver Lake Sports" or "Shaver Lake Sports Inc" (incorporated 2004; never "LLC").
- Ship to (SLS): 41777 Tollhouse Road, Shaver Lake, CA 93664. 41698 Tollhouse Rd is the old SLS address (until
  2019) and is now the Hardware store, across the street.
- Bill to (when not billed through WWD): P.O. Box 60, Shaver Lake, CA 93664.
- Phone: always the store, 559-841-2740.
- Attn: only Dana, Jarrett or Tyler.
- Wanted (proposal pending go): when Claude reads a vendor's confirmation or invoice and any of this is wrong, it
  drafts a correction email to the sender and the rep (or the rep alone).
- Same day (Dana, "Go on all 3"): orders not in VMS are added whatever their age (long buying cycle; February orders
  are still coming); older than 4 months they note "Added from sent mail, check status." The scan also reads sent mail
  in the personal mailboxes (Jarrett sent orders from jarrett@ for a while); only the order is shared, the email stays
  private. Jarrett's mailbox is pulled back 12 months (it started at Jul 13).

## Oct 12 — Notifications page; text reminder consent for Twilio (Dana: "Go")
- Each person's reminder choices (dashboard, email, text, cell number) live on **Notifications**, under the name menu at the
  top right. Dana also has it as **Settings → Notifications**. The Tasks page keeps a link to it.
- **By text** starts unticked for everyone. Ticking it shows the full consent text (what, how often, rates, HELP/STOP, links
  to Terms and Privacy) and the button reads "Yes, sign me up for texts". Every text ends "Reply STOP to stop."
- Public pages for the Twilio toll-free verification: /sms/ (opt-in proof, with /sms/opt-in.png), /sms/terms.html,
  /sms/privacy.html. Vercel no longer rewrites /sms/ and /brand/ to the app (that is why /sms/ asked for a login).
- Same day: the sent-orders sort asked Claude for a list keyed by email id and its answer was cut off (stuck 05:10–05:40
  UTC); it now answers with item numbers. Matching was too strict on totals (sheet totals differ from the email's):
  the vendor's order within 5 days of the email now counts (closest date, then closest total). Five added orders that
  were already on Dana's sheets were merged into them (Nationwide 8/21, Royal Deluxe 7/13, Hendrix 7/19 and 6/28,
  one more 5/6).

## Oct 12 — Mail: Primary and Promotions
- The Mail tabs are **Primary** (was Needs attention) and **Promotions** (was Offers & catalogs), like Outlook's Focused and
  Other; Freight and Everything stay. The vendor page Mail box has the same two tabs with counts and opens on Primary.
- Mail is sorted email by email: a vendor's promos (even from a rep's own address) go to Promotions; rep notes,
  confirmations, invoices and shipping stay in Primary; conversations we wrote in stay in Primary; Claude decides the rest.
- **Move to Promotions / Move to Primary** teaches that kind of mail (newsletters, offers, regular mail) from that
  **address** only, not the whole vendor. A move in a personal inbox teaches that inbox only.
- Companies marked Marketing (never bought from) always go to Promotions. "Other – not a vendor" senders' ads go to
  Promotions; their regular mail stays in Primary.
- The last 12 months, personal inboxes included, were re-sorted; Claude re-read the emails it had kept in Primary.

## Oct 12 — One Review card and Review queue tabs
- The dashboard's "Confirmations & invoices to review" and "Review queue" cards are now one full-width **Review** card
  with counts: Confirmations, Invoices, Needs a hand (unreadable or unmatched paperwork), Needs an answer?, Who is this?,
  Vendor changes (duplicates, renames, categories, LS markers), Freight. Each shows "N with you" in amber, following the
  Showing switch. Clicking a count opens the Review queue on that tab.
- The Review queue page has the same tabs; paperwork tabs list the checks, each opening its check page.

## Oct 12 — Claude sorts "Who is this?"; Never bought from list
- Claude (Sonnet) reads each unknown sender once, orders@ mail only: one of our vendors → filed there, listed on the
  vendor page's Mail box with **Undo** (back to "Who is this?"); a company we have never bought from → Marketing (always
  Promotions) and the **Never bought from** tab; unsure (reps for several lines, platforms, carriers, banks, personal,
  not enough to tell) → the card stays.
- Never bought from tab on the Review queue (no dashboard count): one row per company with every address, website and
  phone from signatures, email count and latest email; search and sort; **This is…** (files to a vendor, keeps the
  name as an alias), **Make it a vendor**, **Leave it** (checked; Check again). New companies land there on their own.
- Oct 12, later: moves teach everyone jointly ("No one wants to sift through junk mail"). A move in any inbox, personal
  ones included, sorts that kind of mail from that address in every inbox; the newest move wins. A rule taught in a
  personal inbox is readable only by its owner and the admin.
  Dana has the last say ("I want the last say in where it goes", go Oct 12): a rule Dana set is changed only by
  Dana; anyone else's move then moves just that conversation. Between the others the newest move wins.
- Oct 12, later: Claude marked 18 clear non-vendors from "Who is this?" as Other – not a vendor (go from Dana): carriers
  (FedEx, UPS, USPS, Cainiao, Speedco), software and services (Dropbox, GoDaddy, Google, Verizon, Avalara, Microsoft,
  Cvent, Link, Frontier) and two bounce senders. Their regular mail stays in Primary for Dana; ads go to Promotions.
  Staff, customers, reps and anything unclear stay as cards (88 left).

## Oct 12 — Freight menu and other freight companies
- The menu item "Freight bills" is now **Freight**.
- New section at the bottom of the Freight page: **Other freight companies** (no account with us): FedEx, USPS, UPS
  (tracking notices; UPS DIRECT stays our billing company), Cainiao, Speedco to start. Their mail is freight mail for
  Trevor ("He receives all the orders so it's good for him to see what we have coming"). Claude adds new freight
  companies it finds in the mail.
- Clicking any freight company's name (or **Emails** on a billing company's card) opens its page with every email from it.

## Oct 12 — Promises in our replies become tasks
- When our reply promises something ("I will have a chance to look at this by tomorrow"), the conversation stays
  **waiting on us**, not waiting on vendor, and whoever signed the reply gets a task due that day, end of business =
  **6 pm** (Dana). Tagged to the vendor and the email; reminder 9 am that day. Finishing the task, or sending another
  reply, ends the promise. Orders@ mail only. Started with the last two days' replies (WFS S102112 among them).

## Oct 12 — Supplies
- New **Supplies** page (Operations). Staff emails to orders@ asking for supplies (Annette Reinhart's Yahoo address marked
  as staff; others with the new **Our staff** button) become requests: To order → Ordered → Arrived. Each new request is
  a task for Dana due in **2 days**. Claude matches order confirmations, shipping and delivery emails (orders@ and Dana's
  own inboxes) to fill in where it was ordered, the order number and the expected arrival, and finishes the task.
- When a new request's confirmation arrives, the person who asked is emailed automatically from orders@. Old requests
  (before Oct 12) were loaded and matched without emails. Requests whose confirmation came from a private inbox show
  only to Dana. Amazon Business confirmations only reach VMS through the old Gmail feed (since Oct 12).

## Oct 12 — Rep groups learned from the mail
- A rep group is recognized by its email, any rep contact's email, or Claude reading the name, signature or rep (Steve
  Newman / pssagency.com → Premier Sales Solutions). The people writing join the rep group's contacts.
- Claude reads a rep's lines from its mail (again after every 10 new emails): vendors with no rep group join it
  automatically; a vendor with another rep group, or a brand that is not a vendor, becomes a "Rep group lines" card.
- Rep mail is tagged to every line it names and filed to the vendor when it names one. All "Who is this?" senders were
  sorted again with these rules.

## Oct 12 — Vendor page, contacts, Amazon
- Vendor page: **Our rep** (name, email, phone) right under the vendor's name; every box except Overview starts closed with
  a count ("Mail · 142 conversations"), click to open. Reps & contacts also sits at the top of the Edit page.
- A contact can be several kinds at once (checkboxes: Rep, Owner, Orders…); the pencil edits a contact.
- Amazon: POs start with the buyer's initials and the store (TP = Tyler Powell, GP = Greg Powell, DP = Dana; SLS, SLH,
  SLM, GS). Claude reads every Amazon order email into Supplies › Amazon with monthly spending by store and person. DP
  orders also go through Supplies; TP and GP orders only to the Amazon list. Tyler will see the list once he has a login.
  Old Amazon mail in sls@gmail can't be scanned; Dana will forward Amazon confirmations to orders@ with a Gmail filter.
- Rep lines: a line already a vendor under a longer name ("Rapala" = RAPALA - NORMARK) joins the rep group instead of asking.

## Oct 12 — Sent mail
- Mail has a **Sent** tab: every email we sent, newest first, searchable by who it went to (name, address, vendor) or
  subject; works per mailbox (private stays private). Each vendor's Mail box has a **Sent** tab too.

## Oct 12 — Worldwide show formats, show list matching
- **Old format (through Spring 2026):** Toy & Home show Sunday–Monday (a day before the main show); main show
  Tuesday–Thursday. Mondays also had the corporate meetings, the Hot Show and the verbal meetings (specials put up and bid
  on until none are left: usually great deals).
- **New format (since August/September 2026):** no separate Toy & Home show; we are there Monday–Thursday. Monday is still
  corporate meetings, Hot Show and verbals. The Jan 25–28, 2027 show is Monday–Thursday.
- Show lists are tied to vendors by name, other names (aliases), or Claude (sure → tied; maybe → "Show list lines" card).
  "Royal Deluxe" on the lists is ROYAL DELUXE ACCESSORIES. Booth holders stay as listed: Manufacturers Exchange is Sunny
  Lakhani (Bluestone, Becker Gloves, Silver Star…); Royal Deluxe was in his booth at Spring 2025, and Sunny took the
  Royal Deluxe toy order after Spring 2026 (likely while Perry was not at the show). Sunny's Royal Deluxe emails are
  tagged to Royal Deluxe Accessories.
- Toy & Home exhibitor lists: Dana is sending the ones she can find; load them and run the matching again.
- Oct 12, later: Spring 2026 **Pre-Show** (Toy & Home, Feb 1–2) loaded from page 3 of the Feb 2026 ShowTime packet (28
  booths; Royal Deluxe T215). WWD had no line listing sheets for Fall 2024 and Fall 2025, and those Toy & Home lists were
  not downloaded. "ORB Toys" and "American Plastic Toys" added as other names of ORB and AMERICAN PLASTIC.
- **Booths** (Dana): "Always double check the booth number. If they are in the same booth, it is generally the same rep
  group." Claude sees booth and booth-mates when matching show lines; a vendor with no rep group that shared a booth (2–15
  lines) with two or more lines of one rep group gets a "Booth-mates" card. Zero upcharge is carried to every vendor whose
  show line is on Worldwide's zero-upcharge list.

## Oct 12 — Drafts
- Mail has a **Drafts** tab. **Save draft** on every email; emails Claude prepares for someone land there marked
  "Prepared by Claude" (owner = the person who will send). A draft can also be copied to orders@'s Gmail Drafts; sending
  from VMS removes the copy. Drafts are private to their owner and the admin.
- First one: the Gold Medal packaging/freight email to Jessica Kane (jkane@goldmedal-intl.com, now a Gold Medal contact).
- Gap found (fix waiting on Dana's go): order emails from NuORDER and similar services do not become orders, and the vendor
  contact they name is not saved (Gold Medal's $798 order of Feb 4 and $636 order; Mykos Sept 1).

## Oct 13 — Signature with the logo; vendor mail from personal inboxes
- One signature template for everyone, with the one-line Shaver Lake Sports logo above it (Dana: "use the Logo I just sent").
  It says **Shaver Lake Sports**, never "Inc"; no Facebook links; only orders@, never a personal email address. Template:
  name, title, Shaver Lake Sports, 41777 Tollhouse Road, mailing P.O. Box 60, store phone (+ direct phone when set),
  orders@ and the website. Dana edits it in Settings › Mail; each person has a name, title and direct phone, or their own version.
- The signature shows in every compose window and can be changed for that one email; drafts keep theirs. It goes above the
  quoted mail in replies. Emails now go out with an HTML version (logo) and the plain text.
- Sending from a personal inbox stays allowed ("orders@ only would be too restrictive"). When it goes to a vendor, rep group,
  ordering service or carrier, or Claude reads it as an order, return or problem, VMS asks once: **Send from orders@
  instead** (new conversation in orders@, filed to the vendor) or **Send from my inbox anyway**. Other mail never asks.
- **Order emails from ordering services** (Dana, Oct 13, "go"): NuORDER, Faire, MarketTime, Elastic and vendors' web
  stores telling us an order was submitted or received become orders (12 months back, then as they arrive): linked to the
  order on file (PO/order number, or same vendor ±5 days and same total, or an order typed with no amount) or added as
  Open. The vendor contact the email names is saved as a Rep (Orders mail only) and set as "taken by".
- **Add our rep** on the vendor page opens Reps & contacts right there with Rep ticked; the person saved becomes our rep
  (Dana: "its just an extra click that is unnecessary").

## Oct 13 — Phones, contacts from email
- **Phones**: a contact can have several numbers, each **Work**, **Cell**, **Fax** or **Other** with a typed label (Dana:
  "Isn't Work and Office the same?" → no Office; "if you pick other you are able to type in what it is"). Old phone text
  was split into typed numbers ("Cell: 208-… Office: 559-…").
- **Contacts learned from email** (Dana: "Contacts go straight onto the vendor with the note it came from email"): Claude
  reads signatures in Orders mail (12 months back, then ongoing) and adds everyone at a vendor or rep group to Reps &
  contacts, marked "Learned from email". Existing contacts only get missing details; typed details and the starred rep
  never change; each address is read once, so a deleted contact stays deleted. Never private mail.
- **Web-order vendors** (Dana: "Any Kellie's order confirmations should not follow the regular order process… We need a
  check mark or something for that"): vendor tick box **Web orders, no confirmation needed** (Kelli's ticked). Their
  confirmation email confirms the order (no check to review; the LS PO draft starts); their invoices are still checked,
  but items they could not ship are only noted, not issues. Kelli's 4 older Open orders were left as they were.
- **Confirmation checks show the email conversation** (Dana: "I have to be able to see the emails threads for this so I
  can properly review the email Claude puts together"): the check page lists every email about the order; Claude reads
  the whole conversation before comparing, leaves out what was already settled, and says where each issue came from.
  The checks waiting for review were compared again.
- **Vendor mail in personal mailboxes is shared to Orders automatically** (Dana: "if the email is from a known vendor" …
  "just not mine" … "fine to auto share the old Gmail"): a conversation in Trevor's or Jarrett's mailbox or the Old Gmail
  is shared once a known vendor or rep group writes in it (also when a sender is filed as a vendor later). Dana's own
  mailbox never is. Taking a conversation back out of Orders sticks. Ran on the last 12 months (86 conversations).

## Oct 13 — Nick
- Dana: "Nick isn't helping me on this so you can stop referring to him." Every step is planned for Dana herself.

## Oct 13 — Freight plan (Dana: "Go!")
- Freight companies join the automatic sharing; an email naming one of our PO numbers is tagged to that vendor and order.
- Freight quotes: no order ships without an approved freight quote. Matching a quote to an order: our PO → the vendor's own
  order/confirmation/invoice number → the conversation → Claude's comparison with the vendor's open orders (never "only one
  open order" alone) → freight-company tracking/PRO or ship-from → Trevor picks. Trevor's task: "Get freight quote: <vendor>,
  PO <number>", due 1 business day.
- Routing letter: versions kept; every send records date, name and email; each email has an "I received the routing
  instructions" button (one reminder after 7 days); a new version goes again to everyone who had an earlier one.
- Order of sending: freight letter now to vendors with open orders (39 with email); WWD list in → confirmation emails →
  about a week later the freight letter to everyone else at their confirmed shipping contacts.
- Confirmation form: their details and phones; company details and coworkers; who gets POs, freight quotes/tracking,
  invoices; how they take orders (email, phone, NuORDER, website); minimum order and any freight programs; other vendors
  they represent (one per box); product categories they sell. "Looks good" or "Submit changes" → Confirmed with the date.
- All WWD vendors are imported; ones never bought from are kept apart as lines ("not bought from yet"), found by search,
  "Make it a vendor" moves one over; emails go only to vendors we buy from.
- Built: Freight › **Freight quotes** (To approve / Which order? / Approved / All, and "Shipped without an approved
  freight quote"), the quote page (vendor's quote, shipment details, Priority One and WWEX prices, Approve the cheapest),
  and the order page's Freight quote card. Quotes are read from emails received from Oct 14 on. Trevor = whoever's title
  says receiving/logistics.
- Built: Freight › **Routing letter** (upload PDF versions, the email text with {first_name}/{open_orders}/{receipt_link},
  prepare drafts per person for open-order vendors / everyone with an earlier version / all vendors, Send all in
  Drafts, sends table with sent and confirmed dates, 7-day reminder), the public "I received it" page (vms…/r/<link>),
  the vendor page's Routing letter box, and "Attach our routing letter" on any email. The letter itself waits for
  Dana's edited PDF.
- Built: Vendors › **Contact confirmations** (prepare one email per person at vendors we buy from, the email text, counts
  by state, the table), the vendors' form at vms…/confirm/<link> (no login; Looks good / Submit changes), vendor page box
  "Their info and what they sell" with **Ask them to confirm**, Confirmed / Bad email badges on contacts, the vendor list
  filter, one reminder after a week, bounces mark the address bad. "What they sell" is its own list (vendor_sells),
  separate from LS categories. New company names and unknown represented vendors go to the Review queue ("From vendor forms").

## Oct 13 (evening) — Confirmations without an order, Pallet/Parcel, previews (Dana: "Go")
- Vendor form asks "Did you receive our routing instructions?" Yes / No. Yes marks the routing letter received for that
  person; No prepares the letter for them in Mail › Drafts.
- PDFs show inside VMS on any computer or phone (VMS draws the pages itself instead of the browser's PDF viewer).
- A vendor PDF whose file name and subject say nothing (Dom's "S102112.pdf") is still caught: VMS reads the email text
  ("sales order", "confirmation", "invoice"), and when that is unclear Claude reads the PDF to decide.
- A confirmation is checked against an actual order first (our PO → their order number → the conversation). Only when no
  order exists does it use the sales report **ticked "Used to place the order"** (Oct 5 decision, now built); when none
  is ticked, the report closest before the show date (or the confirmation date), marked "Not ticked – please confirm".
  It compares with the report's **Order** column, or **Need** when Order is blank, and summarizes what the confirmation
  got right, what is missing and what is extra or a different quantity (Dom: BG-81 should be 18, 983 should be 12).
  No order and no report → the Review queue as "No order found".
- No PO on a confirmation: the person who placed the order (Dana or Jarrett) gets a task "Create PO: <vendor>, <their
  order #>" unless the order already has one; once the PO is typed on the order, an email asking the vendor to put our
  PO on their order waits in Mail › Drafts.
- Uploads check the size first and say plainly when a file is too big; the limit is 50 MB.
- Freight quotes ship one of two ways: **Pallet (P1)** — Trevor gets a Priority One price only; **Parcel (WWEX/UPS)** — a
  UPS price through WWEX only. Claude picks from the vendor's quote (pallets or boxes, weight, box count); Trevor can
  switch. Task: "Get freight quote: <vendor>, PO <number> – Pallet, P1". Approve compares the vendor's price with that one.
- Filing or ticking a sales report re-checks that vendor's open confirmations from the last 6 months that had no order,
  no item list or an unticked report (Dana: "will it notice I have uploaded a sales report…?" — yes). Migration 0103.
- Dom's "Failed to fetch": the WFS upload never reached VMS (4 tries, 06:29–06:33 UTC, none arrived), the usual sign the
  browser could not read the file (open in Excel, or a OneDrive file not on the computer). Uploads now read the file
  first and say so plainly.

## Oct 13 — Connecting to Lightspeed (Dana: "Go!")
- LS support (ticket #6452518) released Dana's email; the old API client can't be recovered. She registers a new one as
  **SLS VMS 2** with redirect https://vms.shaverlakesports.com/integrations/lightspeed/callback.
- **Settings → Lightspeed** (admin): paste Client ID and Secret (kept hidden, service role only, never shown again), choose
  access (read only for now; full later for POs), **Connect to Lightspeed** → LS sign-in → back to VMS, which reads the
  account and counts the items. **Check the connection**, **Disconnect**. Migration 0104, function `lightspeed`.
- Oct 13: connected. Dana registered the API client with billing.slsports@gmail.com (her dana@ email stayed blocked at LS);
  the store sign-in links account 222531 "Shaver Lake Sports", 16,794 active items. LS counts items with `count=1` and no
  `limit` (paging is by `after` cursor).

## Oct 13 — One PO number, created in Lightspeed (Dana: "go")
- Dana: "We always try to use only one PO … Simplicity is best." Our PO is **[VENDOR][MMDDYY]** of the order date (YAKIMA080626),
  kept in the LS PO's **Reference #** (Trevor's habit); LS's own PO number (#10) is not used — VMS keeps it (orders.ls_order_id)
  only to find the PO. Some older Reference #s hold the vendor's own numbers because vendors weren't asked to use ours; the
  PO follow-up email fixes that going forward. Edenred (WWD invoices) shows our PO when the vendor submitted it.
- Each vendor has a **PO code** (from its name: KELLIS, SHARKEYES; editable) and its Lightspeed vendor (matched by the LS name
  already on 764 vendors, else by name without "- WWD", else picked on the vendor page). A second order the same day: -2.
- **Create PO in LS** on the order (and from the Create PO task): empty PO for the vendor and store (SLS = LS location 3,
  SLM = 1, GS = The Happy Camper 2; the Hardware store isn't in LS), Reference # = our PO; the PO goes on the order, which
  drafts the "please add our PO" email and closes the task.
- **Send to Lightspeed** on the approved LS PO draft adds its items to that PO (found by System ID, Vendor ID or UPC); items
  not in LS yet are listed to add in LS by hand, then **Send again** adds only those. Creating new items in LS is not built.
- Reconnected with Full access (needed for POs). Migration 0105.
- Oct 13: the Hardware store (SLH) is on a separate Lightspeed account; connecting it comes later. Until then SLH orders
  have no LS location in VMS.
- Oct 13 (Dana): VMS does not create new items in Lightspeed until she and Trevor sign off on the naming conventions (the LS
  category standard). Until then new items are added in LS by hand and **Send again** puts them on the PO.

## Oct 14 — Credits, billing-system invoices, no duplicates, and back-checks (Dana: "go")
- WFS credit memo CM2600409 ($71.70) sat in Invoices: Claude can now answer "credit"; credits go to **Credits** with no
  invoice check. File names/subjects/email words saying credit memo file it there directly.
- WFS invoice I88431-4 came from NetSuite (system mail, marked bulk) and the paperwork step skipped bulk mail: now included,
  judged by file name and subject only (no email words, no Claude).
- Rule for every session (CLAUDE.md): every filing change re-checks everything already filed, for all vendors; never two
  copies of a file (link to the one on file; `vendor_links_dedupe` hourly). Migration 0106.

## Oct 14 — Tasks take you to the work (Dana: "go on all of it")
- Dana: a task box with only dates "is all I see"; "If the system already knows what order its for I should land right
  there"; "it should automatically open there". Clicking a task opens its work, on the step: Create PO → the order with
  the Create PO in LS box highlighted (else the check, Claude's best-guess order picked in advance); reply promises → the
  email with the reply open; freight quote, LS PO, supplies → their pages; hand-made tasks → what they're tagged to.
  **Edit** opens the old box; its tags are links. Creating the PO in LS still takes one click.
- Pay-by tasks: VMS never pays. The box shows the bill, **Pay in Edenred** (WWD) / **Pay in Bill.com**, and **I paid it**
  (marks the bill paid now, closes the task; the import adds the payment number). Edenred's address is saved once. Migration 0107.
- Oct 14, back-check after the year of mail was re-filed: 194 papers filed (138 invoices, 37 confirmations, 19 credits) for
  ~60 vendors; 65 new checks. Two WFS files were wrong because the quoted older mail said "invoice": the paperwork rule
  now reads only the email's own words, and return labels / RAs are not bills. C2500557 → Credits, RA2500525 → Other.
- Oct 14: VMS's Claude Console account (Shaver Lake Sports Inc) got low-credit emails after the year-long re-filing
  ($14.45 spent this month, $3.83 of it that day). Dana added $100 of credit and will raise the $25 monthly limit.
- Oct 15, never guess: Dana: "I don't want any guessing ever … Guessing costs me time I don't have. We need to be solving
  real problems, not 'guessed' problems." Claude had blamed a failed invoice reading on the paper's length without
  checking; it was a short invoice. Every explanation is now confirmed from the data, logs or code first (CLAUDE.md rule).
- Oct 15, Planet Cotton (Dana): "I want to know why claude did not create that order from the email that I sent." It did:
  the Oct 12 typed order became the order with its 20 lines, and the confirmation was compared with it (2XL at $8 not $6,
  a $21.60 tag charge, no ship date). The page showed the two design pictures from that email as "Our orders" instead.
  Now only files that show what is ordered (order form, PO, spreadsheet, photo or screenshot of the order) are Our orders;
  pictures of the products or design go to Images; the check page links **Our order in VMS**. Back-check over every sent
  order with files in Our orders (Claude reads each again for that one answer).
- Oct 15, main rep (Dana): "We need to be able to tag our main person we place orders through, then the rest of the contacts
  are just there for reference." With a rep group, the group's rep is the main rep unless another is picked (**Make main
  rep**); the company's own people learned from email are customer service, never rep (Heather Studds and Western Woods'
  Cassi fixed). Any contact card, rep group people included, opens for editing with a click.
- Oct 15, proofs (Dana): one **Proofs** folder; each proof is **Not approved yet** or **Approved** (gold star, date,
  who), **Mark approved** / **Not approved**. Proof-named files from email (…PROOF.pdf, Art Approval, mock-up) file there
  by themselves; back-check moved 3 (Planet Cotton's SL Mountain proof, two Art Approval V3 images).
- Oct 15, reading papers: Planet Cotton's 16-page invoice failed because the newer Claude model thinks before answering and
  the thinking used half the answer's room. Copying a paper now runs with thinking off, 32,000 tokens of room, and long
  papers are read in parts; every printed row is its own line. The "confirmation, invoice or other?" step had the same
  problem (3 PDFs came back "other"): thinking off and more room; the 73 emails with unfiled PDFs were sorted again. A
  failed reading now records what Claude sent back. Also found: freight quote emails were refused by the API since the
  quote reader was built (27 optional fields, limit 16), so no quote was ever read; fixed.
- Oct 15, pictures (Dana): "I don't want logos downloaded, total waste … I don't want to have to sift through a bunch of
  useless logos just to find pictures of products." Claude (cheapest model, thinking off) looks at every picture before
  it is saved: product photos and advertising go to Images, proofs to Proofs, logos never; a rep group's logos of the
  companies it reps add those names to its lines. "Nationwide sends way too many emails of the same stuff": vendors marked
  **Ask before saving pictures** (Nationwide first) get only their proofs saved by themselves ("proofs or things to approve
  those need to get auto saved"); invoices and confirmations as before; their other pictures wait for **Save pictures to
  Images** in the email. Back-check over every picture already in an Images folder.
- Oct 15, usual charges (Dana): "There's always a tag charge with Planet Cotton and some of our other independent
  vendors." Vendors have **Usual charges** (Planet Cotton: Tags $0.15 each); at that price a charge is not an issue. A red
  row on a check has **This is a usual charge for this vendor** to teach it once.
- Oct 15, sales report upload (Dana): the WFS "8-29-26 … SALES v3" report would not upload ("doesn't look like an LS sales
  export … System ID"): **Upload sales report** only took the raw LS Analytics export, and this one was already formatted
  (Size Summary first, item tabs with a title row, her Order column on By Category). Now a formatted report is filed as it
  is, its items read back for the suggested order, and the confirmation check uses the tab with the most Order quantities.
- Oct 15, orders settled at the show (Dana, WFS): "once we meet with them at the show a lot of things change on our order
  column … I still want quantity flagged, just not new items. I will always look at the confirmation just to double check
  the new items." Vendors marked **Order is finalized at the show** (WFS first): new items on a confirmation are listed as
  **New items to double check**, not issues or email; quantity, price and missing items still are. **This is our order** on
  a confirmation saves its lines as the order. **Upload sales report** asks "Did you place an order from this report?":
  Yes tags it Used to place the order (no suggested order pops up); Not yet files it and opens the suggested order.
- Oct 15, forwarded vendor mail (Dana): "How do we get Claude to handle a forwarded invoice or confirmation from a vendor
  who sent it to the old Gmail or even to my billing email or Jarrett's email?" A forward from one of our addresses (our
  domain plus organizations.own_addresses: old Gmail, billing@, Jarrett's and Trevor's business Gmail, danapowell2024,
  shaverlakesportssheets, shaverlakemarina) is the vendor's email: the forwarded From: line decides the sender (the person
  in brackets over a billing relay like NetSuite), and the file steps run on it. Our own addresses are never a "Who is
  this?" sender (the old Gmail card closed). Back-check over 12 months: 424 forwards re-read.
- Oct 15, spreadsheet confirmations (Dana, "go"): Panther Martin's rep Bruce sent his copy of our order as Excel ("I had to
  change two models from 18 units to 24 to fit the standard case pack"), forwarded from the old Gmail, and it was not
  filed. A vendor's or rep's spreadsheet copy of our order is now their confirmation: filed in **Confirmations** and read
  and compared by Claude like a PDF. Spreadsheets named like price lists, order forms or writers, UPC or cost lists, ATS,
  guides or sales reports are never taken. In a forward, the vendor's words count, not the forwarding note. Back-check over
  12 months: 78 emails with 100 such spreadsheets are being sorted again.
- Oct 16, Supabase Pro (Dana): the free plan's 1 GB file limit was passed (VMS files 1.29 GB); Dana upgraded the SLSI
  organization to Pro ($25/month, 100 GB files, daily backups). While checking after the upgrade: the sent-orders job had
  run out of memory every 11 minutes on Jarrett's Sep 14 "Re: Pure Fishing Order Help" (an 8.6 MB show-order
  spreadsheet), retrying forever; it never reached Claude, so it cost no API money. Spreadsheets are now opened lightly
  (values only, first 10,000 rows of a sheet), and an email that stops the run twice is set aside as too big.
- Oct 16, a rep is entered once (Dana: "I need a way to only have to enter it once"): she typed Travis Anderson, JRA
  Sales' new rep for Pure Fishing (replacing Aaron Garcia), on the vendor, and the JRA Sales rep group stayed empty. A rep
  typed on a vendor that buys through a rep group now has **Works for** (the group) ticked: they are saved once on the
  rep group and show on all its vendors. The rep group's **Add rep** lists reps already typed on its vendors (**Add to
  this group**). Claude had skipped Travis as "not JRA Sales" on Oct 13 although his address is @jrasales.com: an address
  at a company already on file for the vendor or rep group now always counts as theirs; the 14 people skipped that way
  are read again. The Claude cost log now records every billed answer by its id (also answers that could not be used);
  VMS showed $9.52 for a day Anthropic billed about $15, the gap not yet explained.

## Oct 16 — Accounting area (Dana: "go"; plan in docs/accounting-plan.md)
- Dana's bookkeeping (taxes, insurance, banking, donations, contracts, accounting firm, non-vendor bills) runs out of
  billing.slsports@gmail.com. She wants it treated like orders@: mail views, automatic document filing into folders,
  bills list, tasks and reminders, and a home page that shows what she is missing. Only she sees it; one more person
  can be let in later with an "accounting" tick, not admin.
- The Gmail moves into Workspace as billing@shaverlakesports.com (import + forward) so VMS can read it. Build starts
  once the mail is flowing.
- Accounting also gets a **contacts list**: the people Dana deals with in that mail (company, person, role, category,
  how to reach them), one light card each, seeded from the mail as proposals she confirms.
- Oct 16, built (step 1): the Accounting menu entry and page, the **Accounting** tick on Settings → Users (admin alone is
  not enough; only Dana has it), and billing@shaverlakesports.com in the mail sync as an accounting mailbox: private to
  people with the tick, never shared to Orders, no vendor auto-share; answered from billing@. Migration 0113.
- Oct 16, built (step 2): **Accounting → Mail** (Primary / Promotions / Everything / Sent; Needs an answer, No answer yet,
  Waiting on them, All open, Handled; round buttons by category; replies from billing@) and **Accounting → Contacts**:
  one card per company (by company domain, bill.com covers inform.bill.com) or per person at Gmail-type addresses,
  proposed from the mail (heard from or written to at least twice, never newsletters only, never our own addresses),
  To confirm / Confirmed / Ignored, Confirm and save with a category, merge, Find new in the mail (also runs on its own
  after every sync). Each billing@ conversation is matched to its contact (exact address, then company domain) as it
  arrives; changing a contact re-matches everything. First pass over the mail already in: 251 contacts proposed, 8,600
  of 9,537 conversations matched. Migrations 0114, 0115.

## Oct 16 — Accounting is a training program; calendar views; the business summary
- Dana: the Accounting area should document everything she does so someone else could do it, "if I want to retire and
  hire someone". So: every task carries its procedure (steps, who to call, which account pays, what to check, where last
  year's paperwork is); procedures are the handbook, one per job; contacts say what they do for us; trackers hold the
  facts (policies, bills, deadlines). First worked example: the property insurance guide (Cal Fair + Hudson/Deans & Homer,
  10 policies, agent Sam Gibbs at Hub International) → Accounting → Insurance tracker, yearly renewal tasks 30 days
  ahead with the checklist, a Procedures page.
- Calendar: week, month and year views of accounting tasks, switch at the top.
- Later (Dana): a detailed summary of what VMS does, "like if someone were wanting to buy the business": a short summary,
  then each category expanded. Keep the per-area notes in docs so it can be written when asked.
- Build order: accounting tasks + calendar + procedures + insurance tracker (step 5 moved up), then documents, then bills.
  Awaiting Dana's go.
- Oct 16, built (step 5 moved up, plus the insurance module; migration 0116): **Accounting → Tasks** (area = accounting, RLS on
  the tick, each task carries its procedure), **Calendar** (week / month / year), **Procedures** (the handbook, Markdown,
  first two: property insurance renewal, send proof of insurance), **Insurance** (10 policies from the 9/24/26 guide with
  their years, Renewed and Policy received buttons, renewal tasks 30 days ahead, daily job), **Who needs proof** (lender
  and contract partners; proposed from requests found in the mail (21 found, Dana confirms), send tasks when a policy
  comes in, Send now from billing@ with the policy attached, Hub sent it, every send logged, "They asked" flag on new
  requests). Accounting home = what am I missing. Hub International: Sam Gibbs and Shelly Recek confirmed as insurance
  contacts. Nearest renewal is Jan 29, 2027 (Sports Store contents), so no renewal task exists yet.
- Oct 16, built: **Accounting → Contracts** (migrations 0117–0118). Each license, lease or loan: the other party and
  contact, term, who signs, insurance required (and which of our policies), payment schedule with Paid, season, renewal
  lead time, follow-up date, renewal procedure. Tasks on their own: each payment 30 days ahead, Start the renewal at the
  lead time (not when the next agreement is already on file), follow-ups. Loaded: SCE licenses 9.4763 (Marina) and
  9.4764 (Happy Camper store) 2023–2027 with their January payments (2027: $52,969.55 and $5,452.00), the executed
  store license 2028–2032 ($5,724.60 rising 5%/yr), the pending Marina 2028–2032 (offer letter sent Oct 16, follow-up
  Oct 30). SCE split into **SCE Power** (bills) and **SCE Licensing** (contracts; Andrew Torres). The three liability
  policies the licenses require (workers comp, general liability, auto; dates from the 2024 certificates) added to
  Insurance with SCE Licensing confirmed as needing all three at each renewal. Procedure: SCE license renewal.
  Seasons on the contracts: Marina Apr 15–Oct 15; Happy Camper a week or two before Memorial Day to Oct 1–15.
- Oct 16, no extra clicking (Dana): "If I have a task that needs to be done I wanna be able to click on it and have it take me
  directly to what I need to do." A proof request showed "see the mail" and opened the whole billing@ inbox; it now opens
  her email. Every "They asked" (overview, Insurance list, the person's page) opens the email itself. Rule in CLAUDE.md.

## Oct 16 — Accounting document folders and file names (Dana)
- Folders by the year the document is about: Contracts / SCE Licensing / 2027, Insurance / Cal Fair Plan / 2026.
- File name: date, who paid or whose (SLS = Shaver Lake Sports, P&S = Powell & Son Properties), the other party and
  number, what it is, the amount when there is one, the kind of paper. Examples:
  always abbreviated, no dash, the amount as paid (whole dollars when there are no cents, $6045.31 when there are), Title Case for the property (Dana, Oct 16):
  "2026-09-25 P&S Cal Fair COM 0301476591 SLS Building $4472 paid.pdf",
  "2026-10-14 GS SCE 9.4764 License 2028-2032 executed.pdf". The SCE licenses are SLM (Shaver Lake Marina) and GS (the
  Happy Camper general store), never SLS; contract labels: "SCE License 9.4763 SLM 2023-2027", "SCE License 9.4764 GS 2028-2032".
- Documents uploaded in chat cannot be filed from a cloud session; Dana emails them to billing@ and the filing step
  (plan §4, next) files them with the rest of the old mail.
- Oct 16 (Dana): the Sports Store building is "SLS building" in names and labels:
  "2026-09-25 P&S Cal Fair COM 0301476591 SLS building – premium $4,472.00 paid.pdf". Policy labels renamed.
- Oct 16, Ty on hold (Dana: "the task should have appeared in January since we opted to skip this buying show for
  them"): a vendor on hold with a look-again date now gets a task that day for the person it is assigned to (Ty: Jan 18,
  2027, Dana, with the hold note). No Create PO task or "add our PO" email for papers more than 30 days old or for vendors
  on hold / do not order (the check goes to Dana). The Ty Create PO task from the Oct 15 spreadsheet re-check (Charlene's
  July 31 re-order sheet) was closed.
- Oct 16, built: **Accounting → Documents** (plan §4; migrations 0120–0121, Edge Function `accounting-file`, cron every
  minute). Every attachment in billing@ is looked at once, newest first, back through the whole mailbox (Dec 2023 on):
  pictures under 400 KB, bulk mail, calendar/zip files and files over 15 MB stay in the email with the reason; the rest
  go to Claude (Haiku, the PDF itself in front of it, with the sender, subject, body, the thread's contact, the known
  parties, policies and contracts) which gives folder (Category / Party / Year the paper is about), the name pieces
  (date, whose, party, number, what, amount, state), the policy or contract it belongs to, and whether it is sure.
  Unsure papers are still filed and listed under Needs a look. Names are built by one SQL rule
  (`accounting_document_name`) so an edit on the page renames the same way; a typed name is kept. Same bytes
  (sha256) are one document; the second email links to it. Files live in their own bucket (accounting-files, the
  Accounting tick only). Drop box on the Documents page for files from Dana's computer; "File in Accounting" on any
  billing@ file; documents listed on each policy and contract page. First two emails: the executed GS license filed as
  "2026-10-14 GS SCE Licensing 9.4764 License 2028-2032 $5724.60 executed.pdf" on the contract; the Hub Fair Plan
  summary email gave a quote, a DIC quote, a summary sheet (the 23 MB policy stayed in the email). About half a cent an
  email. Step 5 (bills) is next.
- Oct 16, check page (Dana): the list of issues under the summary repeated the table below it without the product names.
  The summary is now one paragraph and the table follows; the list shows only when there is no table.
- Oct 16 (Dana): Emery Jensen invoices auto-forward from billing@ to bill.com; she pays through the EJ portal by ACH and
  records the payment in bill.com, which syncs to QBO. So EJ papers stay out of the Accounting folders. Built (0122): a
  contact's **Their papers** setting (file / leave in the email, with where they are handled); the filing step skips
  those with the note, and changing it re-checks the old (filed papers come out, or the emails are looked at again).
  Emery Jensen confirmed as a Bills contact (emeryjensen.com) set to "handled in bill.com". Gmail's own filters could
  not be read: the Workspace connection is not allowed mailbox settings (scope gmail.settings.basic). The hand-forwards
  to shaverlakesports1@bill.com (293 since 2023) name the other companies that go there.
- Oct 16, final confirmed order (Dana: "I should be able to change quantities ... delete it ... check mark that it's
  ok. And then it should create the final confirmed order back to the vendor in the email with a summary of what was
  fixed ... with the item number and the name"): each item row on a confirmation check has a **Final** quantity, a tick
  (take the confirmation's number) and remove. **Review & send final order** writes the email: what changed (item number
  and name), then Dana's line "Please reply to confirm this order. If any quantities don't fit your case packs, let me
  know so I can adjust and then we can finalize the order.", then the whole final order. Once sent, the final order
  becomes the order's lines.
- Oct 16, 11:40–12:10 UTC, **database outage**: the Supabase project (Nano compute, no add-on) reported db, REST and
  storage unhealthy; simple reads waited 100+ s on disk (wait event DataFileRead), no lock waits, few connections.
  The `accounting-file` job had run every minute since 07:30 (3,000+ emails, 628 papers filed, $1.67). Pausing it and
  cancelling the diagnostic scans brought the project back in about 90 s; restarting it every 2 minutes took the project
  down again within a minute; paused again at 12:08 and it recovered. **The filing job stays paused** until Dana
  checks the Disk IO budget graph (Supabase dashboard → Reports → Database) and decides on the compute add-on
  (Micro, about $10 a month); `setup-mail-cron.mjs` now schedules it every 5 minutes, not every minute.
- Oct 16, prices on confirmation checks (Dana: the cost is in the sales report, on By Description; "there's no guarantees
  about what we're going to pay this time … our shipping costs are included"): the report's cost is read from any tab and
  shown as **Last cost (ours)** next to **Their price** from the confirmation; a price difference is never an issue. Their
  price more than 20% above our last cost gets a yellow note and an **Ask about price** box; ticked, the email says "your
  price $… is quite a bit higher than we paid last time. Can you check it?". Our cost never goes in the email; the final
  order shows the vendor's price. Dom's WFS check re-run: 48 of 53 rows have our cost, one flagged (XHB-020).
- Oct 16, artwork approvals reach the proof and the order (Dana, "go"): Dana approves from orders@ (VMS or Gmail; her own
  danapowell2024 address is not used for approvals). When a conversation's artwork is approved, the proofs filed from it
  get the Approved star and the order it is filed to shows "Artwork approved" with the date. Back-check: one approved
  conversation, no proof or order attached to it.
- Oct 16, Worldwide portal (Nichole Pence, WWD: "that information is not available and would need to come directly from
  the vendors"): VMS reads the vendor directory from the portal itself. A **Send to VMS** bookmark (Settings ›
  Worldwide; Dana's private key, nothing to install) sends the page she is on; if the portal blocks it, the page
  downloads and is uploaded there. Step 1: the Vendors list and one vendor's page, so the reader is written from the real
  pages; step 2: one click goes through every vendor in the portal. Direct and Faire vendors are not in the portal.
- Oct 16, Worldwide portal into VMS and Lightspeed items per vendor (Dana, "go!!"). All 1,825 portal vendors read by
  the **Read all vendors** bookmark; **Bring into VMS** (Settings › Worldwide) lands them. 248 tied to our vendors (148
  same name or other name, 100 through show-list lines already tied); their empty fields filled (address 237, phone 217,
  minimum order 205, payment terms 198, free shipping 212, freight terms 225, returns 226), 468 people added as
  unconfirmed contacts (2 more on the vendor's own rep group), 340 programs kept in `vendor_programs` (never dropped;
  a vendor can list one Standard program per brand). Where Dana typed something different hers stays: 27 **Worldwide
  portal differences** cards (phone 7, free shipping 7, freight terms 3, others). 16 look-alike names (Taylor's & Co →
  TAYLOR BRANDS, Northland Fishing Tackle → NORTHLAND, Tara Toy Corp → TARA TOYS…) are cards; Do-It Corporation and
  Do-All Outdoors no longer match DO-GREE (the portal's spaced dashes are read as one name). 1,281 new lines "not bought
  from yet" (1,577 portal vendors are lines in all); a line tied later (card or Make it a vendor) gets its portal details.
  (Corrected Oct 17: the portal does show "Zero Upcharge"; see below.) Portal people include reps for other
  territories; their territory and rep company are in the note. Billing terms VMS has no name for (25, e.g. "2% 30 Net
  60") stay on the program only. No rep groups created.
- Lightspeed items (Dana): VMS reads every LS item, active and archived, with its vendor, and counts them per vendor:
  **Active in LS** (has active items), **Inactive in LS** (only archived items), **No items in LS**. Shown on the vendor
  page (tag and "212 active, 40 archived items") and as a filter and sortable **LS items** column on the Vendors list.
  It is a priority label for the bulk "update your info" emails (Active first, then Inactive, then never purchased from,
  after Dana's review list); it does not change the vendor's Active switch. Reads weekly (`ls-items` cron, every 5
  minutes it carries on a reading); **Read LS items now** in Settings › Lightspeed. Taylor Brands: Dana considers it
  inactive (old archived knives).
- Oct 16, first LS item reading: 47,716 items (16,813 active, 30,903 archived; LS's own active count on Oct 13 was
  16,794). Vendors: 510 Active in LS, 207 Inactive in LS, 34 No items in LS, 24 not tied to an LS vendor. 7,995 items
  have no vendor in LS (238 of them active). 10 LS vendors with items are not tied to any VMS vendor (238 items, e.g.
  CROSSMAN, ESCO TRADING - DANDYLINES WWD, REEF SPORT SUNCARE - SANDBOXX). Taylor Brands: 8 archived items, Inactive.

## Oct 16 — Reports from Lightspeed, replacing LS Analytics (Dana)
- LS Analytics costs $75 a store a month; VMS replaces it by reading sales and stock straight from the Lightspeed
  API. Analytics stays on until the new reports are proven ("until we are sure everything is working correctly").
- **Sales Reports page** (the placeholder in the menu becomes real) with the options: date range (last 12 months by
  default), one or two vendors (Paricon plus Slippery Racer), one or more categories (narrow a vendor to a category, or
  a full category across every vendor to catch the same item ordered from two vendors and to decide when to move an
  item from one vendor to another), and stores. A **Reports** button on the vendor's ordering card opens the page with
  that vendor picked. Saved runs (one click next time).
- Every run follows **Sales Report Formatting Spec v49** (`docs/sales-report-spec.md`; sample
  `8-29-26_FOOTWEAR-HIKING_SALES_v2.xlsx`: Size Summary, By Category, By Vendor, Overlap, Flags, Active, No Data,
  Archived, Archived – No Sales (Ignored), Recommendations). File names carry the initials of whoever runs the report.
  The Size Summary merges spelling variants of one size ("SZ 8", "SIZE 8") into one row and notes the variants.
- Stores: the connected LS account has SLS, SLM and GS. SLH is a separate LS account, not connected, left out for now.
  Three ways to run: all stores together (one Sold and one In Stock column summed), one store, or all stores separated
  (a Sold column per store, then an In Stock column per store, then the combined Need).
- Vendor runs and inventory checklists are filed under the vendor; category runs under Reports.
- **Inventory checklists** follow **Inventory Report Formatting Spec v15** (`docs/inventory-report-spec.md`): System ID,
  UPC, Vendor, Description, Category, In Stock, then blank Floor (peach), Back Stock (blue), Bins (green), Total
  (yellow), sorted category then description, every item included, named "M-D-YY NAME INVENTORY". Employees count on
  paper, then enter the totals in VMS on that checklist; **Send to LS** creates a new Inventory Count in Lightspeed's
  Inventory Counts module (API: InventoryCount with a name and shop, InventoryCountItem per item) so missing items
  and shrinkage show in LS before Dana reconciles there. VMS never reconciles. The count's name defaults to the
  checklist's name and store and can be changed before sending (Dana: keep the defaults for continuity, allow the
  outlier). Two new ticks under Settings → Users: **Enter inventory counts** and **Send counts to LS**. Sending needs
  the full-access LS sign-in (the current connection does not record its access; reconnect if needed).
- Order of build: 1) Sales Reports page with vendor and category reports from LS, store choices, Reports button;
  2) inventory checklist, count entry, Send to LS, the two ticks. Dana's first use: kids shirts (long and short
  sleeve) by size across stores, sizes 5, 6, 6x, 7, 8, 10, 12 and XS–XL where a vendor uses letters after 6x.
- Oct 16, built (step 1 of the reports): **Sales Reports** page from Lightspeed (migration 0141, function `ls-sync` every
  minute: items with stock per shop and Vendor ID, sales, sale lines; a 24-month backfill, then what changed). Vendor
  and category reports by spec v49 with the Size Summary by gender, subcategory and size (spelling variants merged with
  a note), By Vendor tab and Vendor column on category reports, stores together / one / kept apart, the period (12
  months default or a date range), initials of the runner in the file name, saved settings, the list of runs, and
  **Reports** on the ordering card. Vendor runs file under the vendor and feed the suggested order; category runs
  under Reports. Lightspeed's "Vendor ID" is the item's vendor number for its default vendor (ItemVendorNums).
- Oct 16 (Dana), inventory checklists: a **Vendor ID** column next to Description; the vendor id is no longer appended
  to the description. Overlap and Recommendations tabs on category reports are still to come.
- Oct 16 (Dana): no limit on how many vendors a sales report can hold ("more than 2 vendors just in case").
- Oct 16 (Dana): a report never downloads on its own; it opens in the page (tab by tab) and is filed, with **Download**
  when she wants a copy. Category reports are filed under every vendor on their Active tab (and any picked) as well as Reports: "it just does it
  automatically".
  The report query runs as the definer with one membership check (0142) so it stays inside the 8-second limit.

## Oct 16 — On order and add-ons on the reports (Dana; plan, not yet built)
- Every vendor and category report looks up what is already coming in (the suggested order's look-up: confirmed
  orders' lines, shipped or invoiced but not in LS, placed orders) and adds two columns after NEED: **ON ORDER** and
  **NEED AFTER ORDERS**, with the order and its ship date in Notes ("12 on PO SLS101426, ships Nov 3"; "no ship date
  yet"). The Size Summary gets the same two columns. Open orders with no item list are named on the Flags tab.
- Add-ons are per order, not per vendor (a pre-order placed months ahead cannot take add-ons; a fill-in order can). Each
  open order gets an **Add-ons** choice: Yes until it ships / No / Ask the rep (blank until set). The report and the
  suggested order say "add to PO …" only for Yes; otherwise "Open order PO …, ships Nov 3, add-ons not confirmed". Ask
  the rep drafts the one-line question from the order page and the answer sets the choice. A shipping notice or invoice
  flips Yes to No on its own.
- **Add to PO …** on the suggested order puts the Order quantities on that order as add-on lines (marked "added on
  <date>") and drafts one email from orders@: the add-on items in a clean table (Vendor ID, description, quantity), the
  original confirmation attached as it is, and a request for one fresh confirmation covering the whole order. With no
  confirmation on file yet, the email says so ("We have not received a confirmation for PO … sent on …; please add the
  following to that order and send one confirmation for the whole thing"), attaches our original order, and the
  order's follow-up date moves with it. The confirmation check then compares against the order plus the add-ons. If the
  rep says no, one click turns the add-on into a new order.
- Oct 16, built (step 2): **Inventory checklists** (migration 0143, function `ls-inventory-count`). Run from Sales
  Reports as "Inventory checklist" for a vendor or category and one store: the v15 sheet with a Vendor ID column
  next to Description, filed under the vendor (folder Inventory counts) and in the runs list; a checklist page to type
  Floor / Back stock / Bins / Total (saves as you go, badge for the difference from LS); **Send to LS** creates the
  Inventory Count in Lightspeed (name editable, defaults to the checklist's) with the totals entered; items with no
  total are left out; the checklist is read-only after. Ticks **Enter counts** and **Send counts to LS** under
  Settings → Users (admins have both). Next: on-order columns and add-ons on the reports.
- Oct 16, built (step 3): **on order and add-ons** (migration 0144). Every sales report carries ON ORDER and NEED AFTER
  ORDERS after NEED (the Size Summary too) with the order and ship date in Notes and the add-on hint; open orders with
  no item list are named at the foot of Flags. Each open order has **Add-ons until it ships** (Yes / No / Ask the rep,
  not set until someone says); Ask the rep drafts the one-line email; shipping turns Yes to No. **Add to PO …** in the
  suggested order (orders marked Yes only) puts the picked lines on the order as add-on lines (marked with the day; a
  confirmed order goes back to awaiting confirmation) and opens the email: the add-on items in one table, the
  confirmation on file attached (else our order sheet, else the original lines in the body), and a request for one
  confirmation for the whole order; with no confirmation yet, the email says so.

## Oct 17 — Lightspeed history back to the start (May 2020)
Dana: "I frequently go back 3 or 4 years … to look at what our sales were during a big year versus a slow year … I think we
started on Lightspeed in May of 2020." Go-ahead given for after the first (24-month) copy finishes, over the weekend of Oct 17-18.
- `ls-sync` gets an older pass: once the 24-month copy is complete, it pulls every sale and sale line older than the copy's
  start (LS filter `timeStamp <`), oldest first, with its own cursors (`ls_sync.older_*`, migration 0145). Checked against
  LS on Oct 17: 215,725 older sales and 442,953 older lines, oldest sale June 20, 2020; about nine hours at LS's pace.
- The Sales Reports page says where the history stands; any date range can be run.
- Dana plans to open VMS to the other employees on Monday Oct 19.

## Oct 17 — Deployment watch
Dana: "set it up to watch the deployments" (she had been getting Vercel's "deployment failed" emails). Vercel posts each
deployment's result to GitHub, so this session has a scheduled task ("VMS deployment watch", hourly, 19 past the hour)
that reads the newest deployment's status; a new failure is reproduced, fixed on the branch when the fix is small and
verified, and reported to Dana in chat; a good deployment says nothing. The Oct 16 10:02 pm UTC failure (commit e53cdcf)
was the broken push fixed in the next commit.
- Oct 17, zero upcharge from the Worldwide portal (Dana: "Yes, add the rules and go on the upcharge fix"). I had told
  Dana the portal has no zero-upcharge field; wrong: its vendor page labels the field `rebateProgram` "Zero Upcharge". I
  went by the internal name and did not check the saved portal page. Every other portal label was checked against where
  it landed; only this one was missed. Fix (migration 150): our vendors whose zero upcharge differs from the portal get
  a **Worldwide portal differences** card (16: 10 portal yes / VMS no, 6 VMS yes / portal no: Crosman, Odd Sox, Prairie
  Schooner, Punita Group, Harry Koenig, Gordini); never changed silently. 164 portal lines marked zero upcharge (carried
  by Make it a vendor). The Worldwide portal box shows Zero upcharge. New standing rules in CLAUDE.md: go by the labels
  people see on the other system's screen, give Dana the label → VMS list before an import writes, and never say
  something doesn't exist until every source is checked.
- Done Oct 17, 18:31 UTC: the copy holds 334,050 sales and 694,943 sale lines from June 20, 2020 to today, no errors; from
  here it only pulls what changed each minute.
- Oct 18, zero upcharge: the show lists win over the WWD portal (Dana: "I would take the show docs over the wwd db. Its
  very out of date. Move the ones from review if the WWD Database is the only thing confirming"). Where VMS's zero
  upcharge came from: 41 vendors from Worldwide show lists (Spring 2025 line listing and WWD's zero-upcharge list, Spring
  2026, Fall 2026), 15 from Donna Hoffman's DandyLines sheet. Migration 155: the portal's zero upcharge no longer asks or
  marks anything (shown in the Worldwide portal box only). 12 cards taken out (kept as VMS has it): 8 portal-only yes
  (Cascade Mountain Tech, Charbroil, Mykos-Lamo, Okuma, Primemotion, Rapala - Normark, Triple T, Troll Co) and 4 where a
  show list or Donna's sheet said yes and only the portal said no (Crosman, Gordini, Harry Koenig, Punita; Donna's
  sheet treated like a show list). Left for Dana: ALPS Mountaineering (Fall 2026 lists "ALPS Brands" zero upcharge),
  Creative Group (Donna lists "Creative Eyewear/Batali" zero upcharge; Spring 2025 lists "Creative Eyewear/Creative
  Group" without), Odd Sox and Prairie Schooner (Donna's sheet yes, Spring 2025/2026 show lists no). 19 show-list lines
  whose "no" migration 150 had overwritten with the portal's "yes" put back. Still marked from the portal alone: 121
  lines (117 portal-only lines and 4 on the Fall 2024/2025 lists, which have no zero-upcharge column); asked Dana.
- Oct 18, zero upcharge sources in order (Dana): Donna Hoffman's DandyLines list (sent Aug 2026) overrides the show lists,
  and the show lists override the WWD portal. Applied: Creative Group set to zero upcharge (Donna lists "Creative
  Eyewear/Batali"); Odd Sox and Prairie Schooner stay zero upcharge (Donna yes, Spring 2025/2026 show lists no). Left:
  ALPS Mountaineering card; the 121 portal-only lines question.
- Oct 18, ALPS (Dana): "some of em go under two names, they're two divisions, and we order from alps mountaineering".
  ALPS Brands and ALPS Mountaineering are two divisions; we order from ALPS Mountaineering only. Go by the ALPS
  Mountaineering line on the Fall 2026 show list (not zero upcharge); the ALPS Brands line's zero upcharge does not
  apply. Card closed, kept No.
- Oct 18 (Dana): the 121 lines marked zero upcharge only by the WWD portal stay marked ("No, leave it").
- Oct 18 (Dana): the "Add Vendor ID to item descriptions" setting stays (vendor, order and item), because a few vendors
  need it. The naming convention leaves the Vendor ID off by default; the inventory reports carry their own Vendor ID
  column.
- Oct 18, discontinued and replaced items (Dana): "I want the notes to show in vms" (LS item Notes: public = prints on the
  customer's sales receipt, private = internal). Discontinued items only matter when running sales reports to decide
  what to order and from ordering to the vendor's confirmation; once the order is placed they are no longer needed.
  Sales reports show discontinued items clearly, and a noted replacement as an item to order. The final confirmation
  summary says "X was discontinued, replaced with Y". When a vendor's confirmation says items are unavailable or
  replaced, Claude records it; what Claude can't settle goes to the Review tab of whoever placed the order. "Staff should
  not have to go in to ls separately … Make the decisions in the review tab and vms relays it to ls": the decision in
  Review writes the * marker and the note (REPLACED WITH <Vendor ID>) into LS. This changes SOP-INV-001-NC's "VMS never
  adds, removes, or changes a marker" (Trevor to update the SOP); needs Full access to LS. Not built yet.
- Oct 18, Review buttons for unavailable items (Dana): Use replacement (* + "REPLACED WITH <Vendor ID>" note in LS),
  Discontinued, no replacement (* + note), Out of stock (no marker; a note in LS like "OUT OF STOCK AT VENDOR 10/18/26";
  the next sales report shows it), DNR / do not reorder for bad quality or poor sellers (** + note with the reason).
  Only Dana, Trevor and Jarrett can choose DNR; anyone else sees "Send a message about DNR to Dana, Trevor or Jarrett".
  Dana asked why "Not discontinued" (for a misread): offered as "Leave as is", not decided.
- Oct 18 (Dana): when the vendor gives a back-in-stock date, the out-of-stock note in LS includes it ("OUT OF STOCK AT
  VENDOR 10/18/26, BACK 11/15/26").

## Oct 18 — Item naming follow-ups (Fable session)
Dana, on the two open questions in `docs/sop/item-naming-notes-for-fable.md`:
- Keep the **Leave as is** button on the unavailable-item Review card (Claude can misread a confirmation).
- ** (DNR) items show on sales reports as well as * (discontinued), marked DNR so they look different.
Proposed split, awaiting Dana's go: Fable copies item Notes into `ls_items` (in `ls-sync`, built fresh; the Opus draft is
dropped) and shows discontinued / DNR / out of stock with back date / noted replacement on sales reports; Opus reads
confirmations for unavailable items, builds the Review cards and the final-confirmation line, and writes * / ** and notes
to LS from Review. Waits on Dana: LS reconnect with Full access; approval of Trevor's three proposals.

## Oct 18 — Lightspeed access level fix
Bug (from the Sonnet session): Lightspeed's token answer has no scope, so `lightspeed_connections.scope` stayed null and
Settings › Lightspeed said "read only" even after a Full reconnect (Dana reconnected at 19:05 UTC; scope was null).
Fix: the access asked for at Connect is kept in `oauth_scope` (migration 0156) and copied into `scope` when the sign-in
completes. Dana clicks **Connect again** with Full once more so the label and `scope` are right.
- Oct 18 (Dana): every note VMS writes to an LS item starts with the date and who decided, because the LS Notes field
  has no date or time stamp: "10/18/26 JW: REPLACED WITH 71240", "10/18/26 JW: OUT OF STOCK AT VENDOR, BACK 11/15/26",
  "10/18/26 DP: DNR: POOR QUALITY" (initials, as the team writes them today, e.g. "8/12/26 JW: DISCONTINUED BY
  COGHLANS").
- Oct 18 (Dana, "Yes"): notes in LS are newest on top: VMS puts its dated line above whatever note is there. DNR is tied
  to Dana, Trevor and Jarrett by name "for now" (a per-person setting), not to the manager role.
- Oct 18, built (Dana, "Yes"): unavailable items on vendor confirmations. Claude's confirmation comparison lists items the
  vendor says are discontinued, replaced or out of stock (with the replacement's Vendor ID, name and price, the
  back-in-stock date and the vendor's words); each becomes an item change (`item_changes`, migration 170) with a card in
  the new Review tab **Unavailable items**, assigned to the check's reviewer (whoever placed the order), and on the
  check under **Unavailable items**. Buttons: Use replacement, Discontinued no replacement, Out of stock (date box),
  DNR (only `profiles.can_dnr`: Dana, Trevor, Jarrett; others get "Send a message about DNR…", a task to the one they
  pick) and Leave as is. Claude's choice is pre-picked when it is sure. Nothing goes to LS without the click. The
  lightspeed function writes it (Full access checked first): * (replaced, discontinued) or ** (DNR; an existing ** is
  kept) at the start of the name, and the dated line on top of the item's note; LS is read back and the change counts
  only when LS shows it. A note that prints on receipts is left alone (the line stays in VMS). The final order email
  says "… was discontinued, replaced with …" / "… is out of stock, back 11/15/26", and the replacement goes on the final
  order at the same quantity. Initials come from `profiles.note_initials`, else the name: Dana = DP; Trevor and Jarrett
  have no last name in VMS, so their notes say TREVOR / JARRETT until their initials are set (asked Dana).
- Oct 18 (Dana): note initials Trevor Jenkins = TJ, Jarrett Watson = JW (`profiles.note_initials`; their names in VMS
  are still first names only). Fixed: on a confirmation check the **Final** box showed 582 for the Lazy One Herd Bells
  rows, the number inside the Vendor ID ("TS582S qty 1 @ $10.45"); a number stuck to letters is never a quantity now
  and "qty N" wins. Nothing was saved or sent with it (no row edits on that check, no final order sent since Oct 16).

## Oct 18 — Item Notes copied; discontinued, DNR, out of stock and replacements on sales reports (Fable, go from Dana)
- `ls-sync` now copies each item's Lightspeed Note (`ls_items.note`, `note_public`; migration 0157). Public = prints on the
  receipt, private = internal. A fresh item pass was started so the notes come in (about 25 minutes).
- Sales reports (`src/lib/itemStatus.ts`): * at the start or end of the LS name = discontinued (salmon row, no Need);
  ** = DO NOT REORDER (salmon, no Need); note "REPLACED WITH <Vendor ID>" carries the old item's need to the replacement
  when it is on the report (its ORDER box starts with that need, note "REPLACES …"); note "OUT OF STOCK AT VENDOR …,
  BACK …" = light blue row with the back date; any other LS note is quoted in NOTES. All of them land on the Flags tab;
  Size Summary and line totals leave discontinued/DNR need out and include carried need.
- Not done here: Opus's Review cards write these markers and notes to LS; the next item pass (every six hours) brings
  them into the reports.
- Oct 18, Ordering box and Ordering card (Dana): now that VMS reads LS directly, each vendor gets **Run report** (one
  click: that vendor's sales report from LS, last 12 months, all stores together; filed under the vendor like a run from
  the Sales Reports page) and **Run order** (runs the report unless one was run today, then opens Suggested order). On
  the vendor page's Ordering box and on each vendor in the dashboard Ordering card. Other settings: the Sales Reports
  page. **Upload sales report** stays (historical reports). Fable builds it (he built the reports and the Reports button).
- Oct 18 (Dana, "handle the chain too"): a discontinued item keeps its own Sold, In Stock and Need on the report (only
  its ORDER is 0); its need is carried to the replacement's ORDER box and noted there ("REPLACES … (sold 12, need 10)").
  Replacement chains are followed to the end (A → B → C: A's need lands on C, "via B"); a chain that ends at another
  discontinued or DNR item, or loops, carries nothing and says to find a replacement.
- Oct 18 (Dana, "If its a decision to be made"): a discontinued item with no usable replacement is a decision, not a
  note. A report that finds one (no replacement noted, one not in LS, or a chain that dead-ends) makes one Review card
  per LS item in Unavailable items for whoever ran the report (migration 0171: `item_changes.source = 'report'`,
  `report_run_id`, `task_id`; `item_changes_from_report`, `item_changes_set_run`). Two buttons: **Find replacement**
  (a task "Find a replacement for …" on that person's list, due in a week, `auto_key item_change:<review item>`; its Go
  button opens the card, where the Vendor ID goes in **Use replacement**, which writes REPLACED WITH to LS and finishes
  the task) and **Don't need** (dated "NO REPLACEMENT NEEDED" line on the LS note, the * stays; we stop ordering it).
  **I know the replacement** is there for when it is known right away. The report's NOTES cell reads "DISCONTINUED: no
  replacement on file — decide on the Review tab" and is a link straight to the card (`/review?tab=items&item=<id>`
  shows that one card on top, any status); the viewer renders spreadsheet links. A decided item's next report says so
  ("a replacement is being sourced", "not needed", or the replacement with the need carried) and never makes a second
  card. `item_change_decide` refuses to re-decide anything except Find replacement.
- Oct 18, shelf tags and price tags (Dana, for Trevor's Proposal 3): every store updates its tags; prices are changed
  once in LS and cover all stores. **Trevor is in charge** of all shelf-tag and price-change tasks: he prints the labels
  and takes them to the other stores for the shelf tags and the price tags on the items. (Proposals still not approved.)
- Oct 18 (Dana): web search is OK as a last resort for item details (Trevor's Proposal 1), but anything found on the
  web needs the approval of whoever placed the order before it is used. Proposals still not approved; Dana wants to
  nail down more details first.
- Oct 18 (Dana, "'Today' is good enough. and go"): **Run report** and **Run order** built (`RunReportButtons`), in the
  vendor page's Ordering box and on each vendor line of the dashboard Ordering card. Run report = that vendor's LS
  report, last 12 months, all stores together, through `runLsReport` (filed under the vendor, feeds Suggested order);
  Run order = reuse a report whose run date is today, else run one, then open Suggested order. A vendor with no
  `lightspeed_vendor_id` (or tied to more than one) gets a plain message pointing to In Lightspeed as / the Sales
  Reports page. **Reports** stays for custom runs; **Upload sales report** is now a smaller link for historical reports.
- Oct 18, who gets what (Dana): from sales reports through creating an order to confirming it, every flag goes to the
  **person who placed the order**. From shipping on (freight, matching the invoice to the confirmation, creating the PO
  in LS, receiving, entering items) it goes to **Trevor**, who is in charge of inventory and logistics and of keeping LS
  organized (VMS now helps him do that). Today invoice checks and "Create PO" tasks still go to whoever placed the order
  (`order_reviewer`); changing them waits for Dana's go.
- Oct 18, built (Dana: invoices and Create PO "should both go to Trevor - If he has a question on an invoice he will call
  me or Jarrett"): migration 175. `profiles.handles_logistics` (Trevor) gets every invoice check and Create PO task VMS
  assigns; a check or task someone hands to a person by hand stays. Confirmations and Unavailable items stay with whoever
  placed the order. Back-check moved the open invoice checks and Create PO tasks (counts reported to Dana).
- Oct 18, covering for each other (Dana): Jarrett enters orders when Trevor is busy or out, and usually helps with
  fishing vendors' orders. Everyone gets an **Away** switch (Dana: "everyone should have that"). Fishing vendors' invoices
  and Create PO tasks still go to Trevor; he hands one to Jarrett when he wants help (option b). Backup details being
  settled; not built yet.
- Oct 18, Away (Dana): only Dana sets someone away and chooses who their work goes to. When the person is back, the one
  who covered decides item by item: keep what they have started, send the rest back (e.g. Jarrett keeps 3 he started
  and sends 4 back to Trevor). Not built yet.
- Oct 18 (Dana): Jarrett and Trevor can always see each other's view ("I should let Jarrett & Trevor always see what they
  have to do"): the Showing switch for each other, set by Dana per person, not only while someone is away. Personal
  mail and accounting stay private. With the Away switch, waiting for Dana's go.
- Oct 18, built (Dana: "If Jarrett can always see Trevor and vice versa, maybe we don't need the away module?? … yes, go
  with the can see"): the Away module is dropped for now. Migration 180 adds `profiles.can_see` (Dana ticks it in
  Settings › Users, **Can see** column); Trevor and Jarrett are set to see each other. Their top bar gets the Showing
  switch with only those names (no Everyone; that stays Dana's). They see that person's dashboard, Review queue, tasks
  and orders, and can take a task (Assigned to) or finish it. Personal mail, Accounting and tasks tied to personal mail
  stay private. Only the admin can change Can see, Can DNR, logistics and note initials (the profile guard now covers
  them).
- Oct 18 (Dana, "We may not have the vendor Id of the replacement item until we get the invoice"): the Find replacement
  card gets a third choice, **Replacement ordered, ID to come** (what was ordered and from whom, or the order). The
  task becomes "Enter the Vendor ID for the replacement of X when the invoice comes", tagged to that order. LS gets a
  dated "REPLACEMENT ORDERED" line on the old item right away (Dana: "i want a dated 'replacement ordered'"); the real
  REPLACED WITH <id> line goes on once the ID is known. When the order's confirmation or invoice arrives, the card lists
  its lines so the replacement is picked with one click. Meanwhile reports say "replacement ordered, Vendor ID to come
  from the invoice" and carry no need (the new item is not in LS yet). Not built yet: waiting for Dana's go.
- Oct 18, item names from web search (Dana): web search is a last resort. A name found that way goes first to **whoever
  is checking the order in**, who approves it or reassigns it if needed (e.g. Trevor to Jarrett when he needs Jarrett's
  input; the normal Assigned to). Not the person who placed the order. Part of Trevor's naming proposals; not built yet.

## Oct 19 — Item naming conventions, part 1: Item names page (Dana: "let's build the naming conventions and we will just adjust where needed")
- Built: Trevor's SOP-INV-001-NC as a checker (`supabase/functions/_shared/itemNameSop.ts`, used by the page and the
  functions; tested on the SOP's own examples). VMS fixes only cosmetic and shorthand things on its own (capitals,
  spacing, marks, accents, approved shorthand, SZ, units); part order, brand, measurements and names over 52 are flagged
  for a person. A change is "cosmetic" (no new shelf tag) or "content" (new shelf tag) by the SOP's rename rule.
- **Item names** page (menu, Operations): tabs Quick fixes / Vendor ID / Needs a look / Sent / waiting / Left as is /
  Pass the SOP, with vendor, category and search filters. Approve and send, or Leave as is. Migration 185:
  `item_name_changes` (the decisions and the send queue), `item_names_decide`, `item_names_undo`.
- Sending: the lightspeed function (`rename_now`, and every 2 minutes from cron) reads each item first and writes nothing
  when the LS name changed since; keeps the * or ** marker LS has; never writes a name another LS item has; counts it
  only when LS answers with the new name.
- Shelf tags: renames that change what the name says go on one task a day for the logistics person (Trevor), "Print new
  shelf tags (N items)", due in 7 days, listing old → new (Dana Oct 18: Trevor is in charge of shelf and price tags).
- Proposal 2: vendor field **Name in item names** (`vendors.item_name_vendor`: WFS, LAZY ONE, COGHLANS, TY set). The
  Vendor ID setting was turned on for Lazy One, World Famous Sports and Ty (Coghlan already had it), as the SOP lists.
  The Vendor ID now goes last after one space (SOP), not in brackets.
- Counts on Oct 19 (16,725 active LS items; 116 rentals/labor/fees not checked): 6,689 already pass; about 7,300 have
  quick fixes only; Vendor ID: 1,061 to add, 1,334 to take off (other vendors), 329 to move to the end, 895 VMS can't
  tell (the name ends in a different code); about 2,800 need a look. Nothing was sent to LS: it waits for Trevor's clicks.
- Still to build (part 2): names on the LS PO (new items named by the SOP from memory, invoice, confirmation, tag photo,
  catalog, web search last with the check-in person approving), new items created in LS, rename on reorder, marker
  warnings on orders, price-change shelf-tag tasks (needs prices in `ls_items`: Fable's ls-sync).
- Oct 19, part 2 built (same go): naming on the LS PO. New items are named by the SOP (`ITEM_NAME_SOP` in
  `_shared/itemNameSopText.ts`, with the vendor's Name in item names and Vendor ID setting), cleaned by the checker,
  unknown parts in [brackets], and flagged (⚑) for whoever checks the order in: Needs manual description, Vendor ID to
  check on the invoice / waiting on the Vendor ID, a name another LS item has. Items already in LS are matched from
  `ls_items` (the vendor's item number, then a UPC only one item has), not only the sales report; their * / ** shows as
  Discontinued / Do not reorder, and a name that breaks the SOP gets a ticked **Rename in LS** suggestion (rename on
  reorder) that joins the Item names queue on Send. **Send to Lightspeed** now enters new items in LS (name, category LS
  already has, vendor, Vendor ID, UPC, cost, retail from Check-in pricing), read back; held back while a blocking flag is
  open. Found while building: the old send matched LS items by manufacturer SKU, which only 318 of 16,725 items have; it
  now matches from VMS's copy first.
- Not built yet: tag photos for Claude to read, web search (last resort, approved by the check-in person), marker
  warnings while working on / sending an order, price-change shelf-tag tasks (needs LS prices in `ls_items`, Fable's
  ls-sync), the dashboard flags list.
- Oct 19 (Dana, looking at Coghlan's names: "I just want consistency"): the Vendor ID always has just one space in
  front of it, never a dash or # (SOP: "no dash, pound sign, or other separator"). VMS now reads "SET - 9869",
  "FT-7610" and "POUCH -1354" as the Vendor ID with a separator and fixes them to one space (a Quick fix, no new tag).
  Before, "SET - 9869" became "SET- 9869", and "-1354" was not seen as the Vendor ID at all, so the page wrongly said it
  was "in the middle". A bare dash after a digit stays (21-4410 is one code). New counts: 6,412 pass, about 7,600 quick
  fixes, 1,338 Vendor IDs to take off.
- Oct 19 (Dana): Jeff Lipke (jefflipke@comcast.net, The Cascade Group) "has nothing to do with WFS and hasn't since I've
  been going to the shows the past 5 years". The Worldwide portal import (Oct 16) had added him to World Famous Sports
  as a rep from WWD's out-of-date WFS page, and with no main rep picked the vendor page showed him as Main rep. Removed
  from WFS; he stays on Triple T (from his own emails). Still on Mykos-Lamo from the portal: not confirmed. Proposed,
  waiting for Dana's go: portal-only contacts never show as Main rep and are marked "not confirmed"; a list of the
  portal's reps to confirm or remove; a re-import must not add back a contact Dana removed.
- Oct 19 (Dana): keep a running list of outdated info on the WWD vendor portal to take to WWD at the January show:
  Claude Doc "Outdated info in the WWD vendor portal" (https://claude.ai/code/artifact/46d5281c-f197-4287-833a-7ca5d6685df0).
  Started with 8 confirmed (WFS/Jeff Lipke, Mack's Lure/Greg Trouth retired, PNW/May Zhou left, Kershaw/Luke Johns,
  Badlands, Midland and Rock Ridge/Brad Grieder, Maschmedt lines/Nick Peterson) and 14 likely (portal Sales Reps with no
  orders@ email in 2 years while someone else is our rep). Add to it as more are found; orders@ mail only.
- Oct 19 (Dana): "The current email threads need to override the WWD vendor info. If Jeff never emailed us in the past
  year, we probably don't work with him at WFS." Process change proposed, waiting for Dana's go (see chat).
- Oct 19 (Dana, on the proposed contact rules, #3): the Main rep comes from email over the last **24 months** (not 12),
  unless Dana picks someone. Pelican Products added to the outdated-portal list (John Waters, from Jarrett's mail).
  The five contact rules are still waiting for Dana's go.
- Oct 19 (Dana): the contact rules use one window, **24 months**, for both confirming a portal contact by email (#2) and
  the Main rep (#3). Jarrett's mailbox (jarrett@) is read back to the beginning (backfill from 2015, about 2.5 years
  of mail expected; old threads come in as handled, no duplicates), so his vendor mail counts too.
- Oct 19, built (Dana: "I want as much historical data as possible added to vms without adding to do's … if something
  came in 2 months ago and it needed attention, but you can see no one has responded, I want to know about it"; "6
  months is good, go"). Migration 190: old mail read in from history is handled only when one of us wrote back to that
  person afterward (any of our mailboxes, any thread: `mail_answered`), we wrote last, it is bulk mail, or it is over 6
  months old; an unanswered question from the last 6 months waits on us (Needs an answer) and Claude's reply check
  reads it; an unsure answer on old mail stays in Needs an answer with no Review card. Senders last heard from over a
  year ago get no "which vendor?" card. Back-check (`mail_reopen_unanswered`): 827 handled threads checked, 494 back to
  Needs an answer (orders@ 367, personal 127) for the reply check to sort. billing@ keeps its 30-day reply check (Oct
  16) and the old Gmail is left alone. gmail-sync files confirmations, invoices, credits, pictures and proofs from every
  year (only the last 6 months start an order check). orders@ is read back to the beginning (it started Oct 2025), as
  is Jarrett's mailbox.
- Oct 19, fix: while orders@ read back into its history, gmail-sync skipped every later step for orders@ (filing,
  paperwork, pictures, freight bills, Claude's sort and reply check) because those waited for the backfill to finish.
  Now a mailbox already in use reads history in a 7-second slice of each run and the daily steps always run. Jarrett's
  mailbox finished: Gmail has nothing older than May 9, 2025 in it.
- Oct 19 (Dana, "all documents folders should refresh itself when any doc lands in there and there is a next process
  that is supposed to take place when it lands"; "Build all 3"): migration 0186. (1) Live refresh: vendor_links,
  order_checks, accounting_documents, sales_reports, report_runs, review_items, ordering_items and tasks are in the
  Realtime publication (replica identity full); `useLiveTable` refetches the vendor Documents box, the order page
  documents, Accounting Documents, the Review tabs, the check page and the Ordering box/card when a row lands, whoever
  filed it. (2) The order check starts on landing: `order_checks_kick` trigger calls order-check through pg_net with the
  check id (vault secret; the scheduler still catches anything missed; never blocks the filing). (3) Next steps: proof
  lands → task "Approve the proof from …" for the order's placer, else the vendor's buyer, else Dana, due +3, auto_key
  `proof:<link>`, finished by Mark approved; credit lands → task "Credit from …" for Dana in Accounting, due +7,
  `credit:<link>`; packing slip lands → tied to its order (PO number / LS PO number / the vendor's one open order,
  `vendor_links_tie_order`) and the order moves to Shipped; LS PO lands → tied the same way. Removing or moving a proof or
  credit drops its task. Back-check: tasks made for proofs and credits filed in the last 30 days (older ones are history),
  untied LS POs and packing slips tied, tied packing slips ship their orders; counts reported to Dana. `?folder=` on a
  vendor page opens that Documents folder (the tasks' Go to it). Help: "What happens when a file lands".
- Oct 19, fix 2: with every year's paperwork and pictures open for filing, filing used the whole run and Claude's reply
  check and artwork approvals (last in the run) never ran. Each gmail-sync run is now: new mail; Claude's reading until
  10 s (reply check and artwork first, sorting after); filing, newest first, until 16 s; history in the time left.
- Oct 19, built (Dana: "yes on the 220 old threads"): questions we asked that nobody answered (migration 195). Old mail
  from history (last 6 months, over a week old) where we wrote last and nobody we wrote to has written back since, in
  any thread: Claude reads our email (`readExpectsReply`, gmail-sync, 10 a run); one that asked them something goes to
  No answer yet (waiting on vendor, past its follow-up date), a "thanks" stays handled. No tasks or cards. Of the 220,
  58 qualified; in the rest the person had written back in another thread.
- Oct 19 (Dana): billing@ is read back to its very beginning (she thinks 2020 or early 2021; VMS has it from June
  2022), but **last priority: after VMS is launched to the employees**, so nothing fights for priority. Its documents
  then go into Accounting › Documents. Not started.
- Seen Oct 19 (not fixed, billing@ is Dana's last priority): billing@ has not synced since Oct 16, 09:51 (Gmail 400
  "Precondition check failed" on one message), and the accounting-file job has hit the worker memory limit every minute
  since at least Oct 18.
- Oct 19, cause found (Dana: "Please find out what is causing the billing@ mail"): since Oct 16, 09:51 Gmail's change
  list for billing@ shows 6,514 messages ADDED, and they are old mail (samples dated Apr–Jun 2022, older than VMS's
  billing@ copy, which starts Jun 10, 2022); billing@ now holds 38,407 messages in Gmail, VMS 31,748. gmail-sync tries to
  take all of them in one run, runs past the 150-second limit and is cut off before it saves its place, so every run
  starts over and the new billing@ mail since Oct 16 never comes in (Dana: more than 10 since the 17th). One run (Oct
  19, 15:00) stopped on a Gmail 400 for one 2022 message; that message reads fine now. Who or what added the old mail
  is not confirmed. gmail-sync has a read-only `diagnose` request (scheduler secret) for this.
- Oct 19 (Dana, Bill.com): light integration only, no auto-entry, no auto-payment. Plan agreed in outline (not built):
  connect with a VMS developer key in Settings (hosted settings, never the repo); every 15 minutes pull the Bill.com
  inbox (not yet entered), unpaid bills with due dates, and the vendor list; dashboard line "Waiting in Bill.com: N to
  enter" (Dana only) and pay-by tasks 7 days ahead that finish themselves when paid. Forwarding is VMS's own mail
  sync, not the Apps Script (Dana: too many labels, too much "needs attention"): when Claude files a vendor invoice from
  orders@ or billing@, forward that email with attachments to shaverlakesports1@bill.com once and mark it "Sent to
  Bill.com". **Which vendors: a Bill.com tag on the vendor that Dana can turn on or off** ("I need to be able to turn on
  or off the bill.com tag on any vendor"); only tagged vendors' invoices are forwarded. Open: WWD left out? 7 days ok?
- Oct 19 (Dana, Bill.com, correction): **no pre-ticking from Bill.com's vendor list** — Bill.com is synced with QBO so
  every vendor is in there; Dana marks the Bill.com tag herself on the vendors she wants sent. The vendor list is not
  pulled at all. An invoice VMS cannot place (no vendor, vendor untagged and unclear, not sure it is an invoice) is
  flagged for Dana's attention, never forwarded on a guess.
- Oct 19 (Dana): **WWD is never to go to Bill.com, totally separate process.** The Bill.com tag cannot be set on
  Worldwide Distributors, and nothing routed through WWD (WWD invoices, WWD-billed vendors' WWD paperwork) is ever
  forwarded; WWD stays on the Payments page flow (EdenRed, payment sheets).
- Oct 19 (Dana, final on the Bill.com tag): "All vendors have a on off switch for sending an invoice to bill.com period.
  No automation needed. I will select the ones that need to go to bill.com, no other method." The switch is on every
  vendor, including WWD-routed ones (some WWD vendors now want to be paid another way), and can be changed any time.
  Nothing else decides forwarding: not the route, not Bill.com's list. Due alerts 7 days ahead.
- Oct 19 (Dana): invoices forwarded by Tyler (typowslm@gmail.com) or Greg (gpowell.slsports@yahoo.com) are the vendor's
  emails: "read who the email is actually from, not who forwarded it", and never flag Ty or Greg as new vendors. VMS
  already read forwards from our own addresses that way (Oct 15) but did not know these two addresses: added to the
  organization's own addresses, both senders marked internal, Tyler's pending "which vendor?" card closed, and the
  forwards back-check run (158 forwards re-read across the mailboxes; of their 943 emails 95 are forwards now read from
  the vendor's From line, 31 tied to a vendor; 140 forwarded senders are new "Who is this?" senders for the queue in
  the usual way, 2 cards made so far). Any new staff address goes on that list.
- Oct 19 (Dana, "ok go on bill.com"): built (migration 0196, functions `billcom` and `billcom-forward`). Settings › Bill.com
  takes the developer key, organization ID and a sync token (token name = username, token = password; POST
  {base}/v3/login → sessionId; devKey + sessionId headers). `billcom` reads GET /v3/bills every 15 minutes (pg_cron),
  fields per the "Get list of bills" page Dana sent: results, nextPage, id, vendorId, vendorName, amount, dueAmount,
  dueDate, invoice.invoiceNumber, paymentStatus (PAID/UNPAID/PARTIALLY_PAID/SCHEDULED/IN_PROCESS), recordStatus,
  archived; kept in `billcom_bills`; `billcom_bill_tasks` makes pay-by tasks 7 days ahead (`billcom:<bill id>`, "Pay X
  $Y by date (Bill.com)") and closes them when paid or scheduled; "I paid it" just closes the task. No vendor list is
  read (vendorName comes with each bill). Forwarding: `vendors.billcom_send` switch (Edit, "Send invoices to Bill.com";
  Vendors list filter; badge); trigger on vendor_links: an invoice from an email for a switched-on vendor queues one
  forward per email (`billcom_forwards`) and pg_net calls `billcom-forward`, which sends the email with its attachments
  from the mailbox it came to (orders@ or billing@) to the inbox address (shaverlakesports1@bill.com), with the
  X-VMS-Notice header so the mail sync never stores the copy; `emails.billcom_sent_at` shows "Sent to Bill.com" on the
  thread. The Bill.com inbox has no documented list endpoint (v3 lists documents per bill only), so "waiting to be
  entered" = forwards with no bill matching their invoice number (or vendor + amount) in 90 days (`billcom_waiting`).
  Dashboard Bill.com card (sees_accounting): bills due in 7 days, sent-not-entered. Production API address
  https://gateway.prod.bill.com/connect is from a third-party page, editable in Settings; Save and connect proves it.

## 2026-10-19 — Tell me when they reply; Edenred from Nichole
- Dana: "flag that email from Nichole so you can tell me when she has responded." Built **Tell me when they reply** on
  any email: the next email from that person (any conversation, received after the watch was set) becomes a task
  **Reply from [name]** for the person who set it, reminded at once by their own reminder choices, opening the reply.
  One reply ends it; **Stop watching** cancels. A reply in mail the watcher can't open never fires it. Migration 0197.
  Turned on for Dana on Nichole Pence (nicholep@worldwidebuygroup.com), waiting on Edenred's **Save** fix.
- Edenred (Nichole, Oct 19 call): invoices back to Nov 2025 are emailed to orders@ in groups ("Emailed invoices",
  noreply@edenredpayinvoice.com, one PDF each); the line-by-line Excel (WWD sequence #, vendor's invoice #, PO) comes
  once Edenred fixes Save. Filing the emailed PDFs is proposed, not built.
- billing@ sync fixed (Dana's go, Oct 19): when Gmail reports more than 500 new emails since the last sync (old mail
  arriving in bulk, like the 6,514 from 2022), VMS takes the mail newer than the last sync by date, a slice per run,
  and moves the cursor on once it is all in. The old ones wait for billing@'s full history load after launch. First
  run: 24 new billing@ emails since Oct 16 came in. gmail-sync also has a read-only "attachment" request (scheduler
  secret) to look at a new kind of paperwork before building for it.
- Edenred invoice PDFs (Dana's go, Oct 19): each PDF in Edenred's "Emailed invoices" mail to orders@ is read by
  Claude (cheapest model), placed on its WWD invoice by the Worldwide Invoice Number on the Invoice Summary page, else
  by the vendor's invoice number (dashes, spaces and leading zeros ignored) and amount; a Worldwide number VMS has not
  seen is added (source edenred). Only blanks are filled, never overwritten. The PDF goes to the vendor's Invoices or
  Credits for the invoice's year, tied to the order; one already on file with the same number, or the same file, is
  linked instead (no duplicates); wwd_invoices.document_id points at it. Files it can't place stay in the email with a
  task for Dana that opens it. Runs first among the filing steps, every Edenred email newest first. Migration 0198.
  Dana: Edenred's "Posted Date" is the day WWD posted the invoice to Edenred, so it is never used as the WWD date
  or the document date (migration 0199). We receive everything at SLS and transfer in LS, so the export needs no
  Ship To Location or Member Name.
- Nichole (via Dana, Oct 19): fields marked AP in Edenred are WWD's own; we use the AR fields. The Edenred import
  reads AR Terms (else Terms Text) and Hard Due Date (AR), never AP Terms or Hard Due Date (AP).
- Dana: keep Edenred's Posted Date. wwd_invoices.posted_date ("posted to Edenred"), from the export's Posted Date
  column and from a PDF's Invoice Summary when blank; shown on WWD invoice lists. The seven Oct 19 PDFs with a
  summary page filled from their pages (migration 0200).
  Found while building: Pucci's invoice 0100056-IN ($394.44) is on two WWD invoices, 7200324 and 7200998.
- Dana (Oct 19): WWD invoices are paid in the WWD portal, not Edenred; Edenred does not track payments (that we know
  of). The pay-by button for WWD bills is **Pay in the WWD portal** (address saved once; kept in
  organizations.edenred_url). Edenred is building an API; WWD may later report payments through it. Ask at the show.

## Oct 19 — Claude prompt cache on every VMS call (Dana: "go")
Anthropic emailed Dana that VMS's prompt cache hit rate is low. Dana said go. Every Claude call in VMS now marks its fixed
instructions as cacheable (`sys()` in `_shared/claudeClient.ts`); the compare prompt was reordered so the per-order lines come
after the fixed text. `ai_usage` keeps `cache_read_tokens` and `cache_write_tokens` per call (migration 0201). Honest
expectation: most of VMS's spend is the emails and PDFs themselves, which change every call and cannot be cached, so the
saving is well under Anthropic's "up to 27%"; the numbers in `ai_usage` will say what it really is.
Found on the way, confirmed in `ai_usage` and git: the unlabeled Sonnet calls (151 of them, $10.63 in the week) were the LS PO
item-naming call for a 42-item PO hitting its 4000-token answer cap and retrying about every 30 minutes for three days; the
Oct 19 LS PO commit raised the cap to 6000 and the call succeeded. No other wasted spend found: the 4,305 billing@ filing
calls were the one-time pass over the mailbox history, now finished.

## Oct 19 — Provider mail watch (Dana: "go on provider email watch")
Dana asked to be told when Anthropic, Vercel, GitHub (and Supabase) write to her. An hourly scheduled task in the Fable
session runs `scripts/provider-mail.mjs` (read-only) over dana@ and billing@ for the last 70 minutes; Claude reads anything
that matters (quota, spend, failures, security, billing problems, service notices) and tells Dana what it says and whether
something needs doing. Sign-in links, login codes, receipts, newsletters and marketing are skipped silently. Nothing is
copied into VMS tables and no mail is sent.
Dana (Oct 19, "go"): when a provider email needs something done, the watch makes a task for Dana (her dashboard, Tasks,
reminded at once, **Go to it** opens the email) with the to-do in Claude's own words and a due date; one task per email
(`scripts/provider-mail.mjs --task`). The email text itself is never copied into the task.

## 2026-10-19 — The five contact rules, with former contacts (Dana's go)
- Dana: "with outdated reps is there still a record that that person was our rep at one point … if we don't know the
  previous reps name, its harder to search for them." Built with the five rules (migration 0202):
  1. Portal contacts start unconfirmed ("From WWD · not confirmed").
  2. Confirmed by mail with that address about that vendor (filed to it, naming it or tagged) in the last 24 months, the
     vendor's update form, or Dana's Keep. Mail dates from every mailbox but Accounting; only dates are kept.
  3. Main rep: starred, else the rep group (not portal-only people), else the vendor's own reps, most recent mail about
     the vendor first. Unconfirmed portal people and former contacts never.
  4. One Review card per vendor (kind portal_contact): Keep / No longer their rep / Delete; closes when all answered;
     refreshed hourly (contacts-hourly cron, :41). The answers are the outdated-portal list for the show.
  5. Removed stays removed: deletes leave a contact_removals row (Jeff Lipke on WFS added); the portal import skips
     them and former contacts.
- Former contacts (vendor_emails.former_at, rep_group_contacts.former_at): "No longer their rep" keeps them folded under
  Former contacts / Former reps with first and last email dates and a link to all mail with them; never Main rep,
  never suggested in the address book; mail from them still files. Delete is for mistakes only.
- Back-check (Oct 19): 467 portal contacts, 63 confirmed by mail about their vendor, 404 not confirmed on 196 vendor
  cards. 122 vendors whose Main rep was a portal-only rep now show none until one is picked or confirmed. Jeff Lipke:
  confirmed on Triple T, not confirmed on Mykos-Lamo (on its card).
- Oct 20 (Dana: "YES"): the contact confirmation email goes only to people we know: not former contacts and not
  unconfirmed portal contacts (those stay on the form for the vendor to remove). The form leaves former contacts out;
  "No longer works here" on the form makes the person a former contact instead of deleting them (migration 0203).
  Before the change: 476 people at 186 vendors; after: about 250. Email text: Dana's new wording (WWD members updating
  records) drafted, waiting for her OK. 116 vendors we've ordered from have no email for anyone (13 more are covered by
  their rep group); our mail suggests one for 29 of them, for Dana to approve. shaverlakesports@gmail.com: VMS only has
  what it forwarded to oldslsgmail@ (248 emails since Mar 2024); its older mail isn't in VMS.
- Oct 20 (Dana: "fix all 4"): Aaron Garcia moved from the Pure Fishing vendor to the JRA Sales rep group; Melissa Nokes
  moved from Jackson Cardinal to the Heckel-Nokes Outdoors rep group (she stays on Panther Martin from the portal, not
  confirmed); the "Pure Fishing" rep group made at the Oct 5 import was deleted and taken off Shakespeare (Pure Fishing
  is a vendor). Jane Grace (peteacher6@yahoo.com) is a former employee (had Trevor's job; jane@shaverlakesports.com).
  Faire vendors skip the confirmation email: built, held until Dana finishes the vendor list (routes and send/skip
  choices are applied together). Dana's list: https://claude.ai/code/artifact/ea97e5cb-e19d-4f52-ac0d-0dcc84b4ee4e
- Oct 20 (Dana): Panther Martin's rep group is Heckel-Nokes Outdoors, with Melissa Nokes as its Main rep (her portal
  copy on Panther Martin moved onto the rep group).


## Oct 20 — Watches paused until the usage reset (Dana)
The hourly deployment watch and provider mail watch ran as turns in the Fable session and used Dana's Fable usage
(95% with three days to the reset). Dana: pause both now; after the reset, rebuild each as its own small Sonnet session
that starts fresh each run, every few hours. Both scheduled tasks are disabled, not deleted.

## Oct 20 — Texts are live (Dana)
Dana: "Twilio set up, verification approved — texts are live." Task reminders by text now go out through Twilio
(`task-reminders`, secrets TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM in the hosted function settings).

## Oct 20, 2026 — Recent Activity on the vendor page
Dana: "when we first open a vendor I'd like a bulleted summary of 'Recent Activity' where it lists (most recent first)
date and brief, one sentence summary of what happened … maybe do the last 5 interactions."
- Top of the vendor page (under the main rep strip and any warnings): the last 5 emails in the vendor's Primary mail,
  newest first, as "10/20/26" plus one sentence Claude writes once per email (cheapest model). A line opens that email,
  scrolled to it. Thank-yous, "got it", out-of-office and automatic notices are left out.
- The sentence lives on the email, so private mail stays private (owner and admin only, unless shared to Orders).
- Back-check: gmail-sync writes each vendor's newest lines first until every vendor (292 with mail) has its 5.
- Also Oct 20: the two Planet Cotton credit tasks (170809CM, 159549CM) closed: both credited, Trevor checked 170809CM
  against the vendor return Aug 14. Dana: anywhere a date shows, show the year too (next).
- Dates always carry the year (Dana, Oct 20: "anywhere a date shows I want year also"): task due dates and reminders,
  snooze times, drafts, the Bill.com card, suggested orders, supply and reminder emails, and pay-by task titles
  (0205 renames open ones). Plain dates elsewhere already showed 10/20/2026.
