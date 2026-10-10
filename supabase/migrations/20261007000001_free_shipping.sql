-- 0017 — Free shipping: the vendor's rule and each order's answer (Dana, 2026-10-07).
-- "We need a setting in vms to indicate NEVER free shipping vs sometimes free shipping. And a place
-- for every order placed whether it qualifies for free shipping as a special or something."
-- Vendors are not equal: some never offer it, some only as a show special or above a volume.

alter table public.vendors
  add column if not exists free_shipping_policy    text check (free_shipping_policy in ('never', 'sometimes', 'always')),
  add column if not exists free_shipping_threshold numeric(12, 2) check (free_shipping_threshold is null or free_shipping_threshold >= 0),
  add column if not exists freight_routing         text;
comment on column public.vendors.free_shipping_policy is 'never = they do not offer it; sometimes = show special or above a volume; always = every order ships free. Null = not set yet.';
comment on column public.vendors.free_shipping_threshold is 'Order value at cost that earns free shipping, when the policy is sometimes or always.';
comment on column public.vendors.freight_routing is 'Our freight routing instructions for this vendor (carrier, account, collect vs prepaid). Shown when an order is placed and checked against the invoice.';

alter table public.orders
  add column if not exists free_shipping       boolean,
  add column if not exists free_shipping_basis text check (free_shipping_basis in ('show_special', 'minimum_met', 'negotiated', 'always', 'other')),
  add column if not exists free_shipping_note  text;
comment on column public.orders.free_shipping is 'Whether this order is supposed to ship free. Null = not stated. Shown next to the vendor''s usual rule.';
comment on column public.orders.free_shipping_basis is 'Why it ships free: a show special, the minimum was met, negotiated, the vendor always does, or other (see note).';

-- Backfill from the Placed Order Summary freight notes: "free", "free 0.00", "free @ $500" and the like
-- mean free; a question mark means not stated; a freight figure above zero means it was not free.
update public.orders
   set free_shipping = true,
       free_shipping_basis = case when lower(freight_notes) ~ 'free ?@' then 'minimum_met' else 'other' end
 where free_shipping is null
   and freight_notes is not null
   and lower(freight_notes) ~ '(^|[^a-z])(free|f|yes)([^a-z?]|$)'
   and freight_notes not like '%?%'
   and coalesce(freight_cost, 0) = 0;
update public.orders
   set free_shipping = false
 where free_shipping is null and freight_cost > 0;

-- Vendor thresholds the notes state outright ("free @ $500"): record the threshold and mark the policy
-- "sometimes" where nothing is set yet. Dana reviews these on the vendor pages.
with stated as (
  select o.vendor_id, (regexp_match(lower(o.freight_notes), 'free ?@ ?\$?([0-9]{3,5})(?![0-9])'))[1]::numeric as amount
    from public.orders o
   where lower(o.freight_notes) ~ 'free ?@ ?\$?[0-9]{3,5}(?![0-9])'
), one as (
  select vendor_id, max(amount) as amount from stated group by vendor_id
)
update public.vendors v
   set free_shipping_threshold = coalesce(v.free_shipping_threshold, one.amount),
       free_shipping_policy = coalesce(v.free_shipping_policy, 'sometimes')
  from one
 where one.vendor_id = v.id;
update public.vendors
   set free_shipping_threshold = coalesce(free_shipping_threshold, 1500), free_shipping_policy = coalesce(free_shipping_policy, 'sometimes')
 where upper(name) = 'ZEBCO';
