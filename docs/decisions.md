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
- Bill.com payments: to be decided. Options are uploading a Bill.com export the same way,
  or marking orders paid manually. Not needed before Phase 5.
- **Credit card prepayment.** Some orders are prepaid by credit card at the time of
  ordering. **Every Faire vendor is paid by credit card.** Prepaid orders are therefore
  already paid before they are confirmed, shipped, or received: payment status must be
  tracked separately from the fulfilment status, so an order can be `paid` and still be
  `awaiting_confirmation` or `shipped`. The "ready to pay" step does not apply to them.
- Sheet layout (header row 2, data from row 3, `=SUM()` total in the last row of column J):
  `Invoice # | Disc Date | Disc Avail | Date Inv | Date Due | Desc (INV/CRD) | Vendor | Inv Amt | Amt Paid | Amt Due`.
  An anonymized template is in `docs/samples/worldwide-payment-template.xlsx`. Real payment
  sheets contain vendor and dollar data and are **not** committed to the repo.
- **Payment method follows the purchasing channel, per order.** The same vendor can be
  ordered through Worldwide on one occasion and through Faire on another, and the payment
  method depends on where that particular order was placed. So:
  - Each order records `channel` = where it was placed: `worldwide`, `faire`, `direct`
    (vendor or rep group), `other`.
  - The channel sets the default payment method: `worldwide` → Worldwide portal,
    `faire` → credit card (prepaid), `direct` → Bill.com unless prepaid by card. Always
    editable on the order.
  - Vendors list the channels they are available through (`vendor_channels`) with one
    marked as the usual choice, so the order form pre-selects it and the buyer changes
    it only when ordering elsewhere.
- Adds to the schema (Phase 4/5): `payments` (batch) and `payment_lines`; on `orders` a
  `channel`, `payment_method` (`worldwide`, `billcom`, `credit_card`, `other`),
  `payment_status` (`unpaid`, `prepaid`, `paid`) and `paid_at`, kept separate from the
  fulfilment status; `vendor_channels` (vendor, channel, is_default, account/login notes).
