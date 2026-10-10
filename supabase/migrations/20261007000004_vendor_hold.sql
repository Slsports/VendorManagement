-- 0020 — Vendor standing: "on hold" and two more reasons (Dana, 2026-10-07).
-- "We should add a reason called 'discontinued line' meaning we no longer wanted to carry their
-- products" (Troll: a high-end line that ran its course). Ty is not a do-not-order: too much stock,
-- some Ty types discontinued and others kept, "we will probably order from them in January if we
-- have sold enough stock". So: a hold with a date to look again, and an overstocked reason.
-- Item-level stop/keep tags per vendor come with the Lightspeed connection.

alter table public.vendors drop constraint if exists vendors_standing_check;
alter table public.vendors add constraint vendors_standing_check check (standing in ('ok', 'hold', 'last_resort', 'do_not_order'));
alter table public.vendors drop constraint if exists vendors_standing_tags_check;
alter table public.vendors add constraint vendors_standing_tags_check
  check (standing_tags <@ array['shipping_fees', 'damaged_goods', 'order_mistakes', 'unreliable_delivery', 'bad_attitude', 'slow_credits', 'out_of_business', 'discontinued_line', 'overstocked', 'other']::text[]);
alter table public.vendors add column if not exists standing_review_date date;
comment on column public.vendors.standing is 'ok = fine to order; hold = not for now, look again on the review date; last_resort = only if the items are nowhere else; do_not_order = never again. A warning, never a block.';
comment on column public.vendors.standing_review_date is 'When to look at the standing again (a hold until January, for example).';

update public.vendors
   set standing_tags = '{discontinued_line}',
       do_not_order_reason = 'High-end clothing line that ran its course; our market is vacationers who forgot something and do not want to spend a lot.'
 where organization_id = '00000000-0000-0000-0000-000000000001' and upper(name) = 'TROLL CO';

update public.vendors
   set standing = 'hold', standing_tags = '{overstocked}', standing_review_date = '2027-01-15',
       do_not_order_reason = 'Too much Ty stock on hand. Some Ty toy types discontinued, others kept (worked out with Claude from the inventory numbers). Order again in January if enough has sold; otherwise wait until we need more and see what is new.'
 where organization_id = '00000000-0000-0000-0000-000000000001' and upper(name) = 'TY INC';
