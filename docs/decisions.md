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
