-- 0052 — Prepaid Direct (Dana, Oct 8): a fourth billing route for vendors paid up front, directly, by
-- credit card or ACH. The way they are paid is kept on the route; orders can be paid via ACH too.
alter type public.billing_route add value if not exists 'prepaid_direct';
alter table public.vendor_billing_routes add column if not exists pay_method text check (pay_method in ('card', 'ach'));
comment on column public.vendor_billing_routes.pay_method is 'Prepaid Direct: paid by credit card or ACH.';
alter table public.orders drop constraint if exists orders_paid_via_check;
alter table public.orders add constraint orders_paid_via_check check (paid_via in ('billcom', 'wwd', 'card', 'check', 'ach', 'other'));
