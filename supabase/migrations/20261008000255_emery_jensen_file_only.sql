-- 0255 — Emery Jensen is the hardware store's supplier: file only (Dana, Oct 27): "Trevor should not be given anything
-- with Emery Jensen, that is the hardware store. I just want you to file anything that comes in from emery jenson in
-- their vendor documents."
--   • Trevor's credit task for EJ (credit 30333) is closed at Dana's request.
--   • EJ is ticked Bought for SLH and paperwork-only (no_order_checks, as Rossignol): its invoices and credits are filed
--     with no order check; its open order checks are dismissed.

set local lock_timeout = '5s';

update public.vendors set is_slh_vendor = true, no_order_checks = true where id = 'e43d9b97-3c37-47a0-88cb-7d6cb8475a2e';

update public.tasks set done_at = now(), closed_how = 'request',
       done_note = 'Emery Jensen is the hardware store''s supplier: its credits are filed only, not Trevor''s (Dana, Oct 27).'
 where vendor_id = 'e43d9b97-3c37-47a0-88cb-7d6cb8475a2e' and auto_key like 'credit:%' and done_at is null;

update public.order_checks set status = 'dismissed', working_at = null,
       read_note = 'Emery Jensen (hardware store) paperwork is filed only, with no order check (Dana, Oct 27).'
 where vendor_id = 'e43d9b97-3c37-47a0-88cb-7d6cb8475a2e' and status not in ('done', 'dismissed', 'not_paperwork');
