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
