-- =============================================================================
-- 0010 — Contact titles: add "owner"; labels in the app are Rep, Orders, AR / Accounting,
-- Customer service, Warehouse / Shipping, Owner, Other (Dana, 2026-10-05).
-- =============================================================================
alter type public.contact_type add value if not exists 'owner';
