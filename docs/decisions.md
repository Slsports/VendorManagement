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
