\set ON_ERROR_STOP on
\pset footer off
\echo '>>> free shipping: vendor policy and threshold, order answer with basis; bad values refused (expect 2 errors)'
set role authenticated;
select set_config('request.jwt.claims', '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}', false);
insert into public.vendors (organization_id, name, free_shipping_policy, free_shipping_threshold, freight_routing) values ('00000000-0000-0000-0000-000000000001', 'Free Ship Test Co', 'sometimes', 500, 'Ship UPS Ground collect on our account') returning free_shipping_policy, free_shipping_threshold;
insert into public.vendors (organization_id, name, free_shipping_policy) values ('00000000-0000-0000-0000-000000000001', 'Free Ship Never Co', 'never') returning id as nev \gset
insert into public.orders (organization_id, vendor_id, status, order_date, est_cost, free_shipping, free_shipping_basis, free_shipping_note, source, source_key)
  values ('00000000-0000-0000-0000-000000000001', :'nev', 'open', '2026-02-02', 640, true, 'show_special', 'Spring show special', 'manual', 'fs1') returning free_shipping, free_shipping_basis;
\set ON_ERROR_STOP off
insert into public.vendors (organization_id, name, free_shipping_policy) values ('00000000-0000-0000-0000-000000000001', 'Bad Policy Co', 'maybe');
insert into public.orders (organization_id, vendor_id, free_shipping, free_shipping_basis, source, source_key) values ('00000000-0000-0000-0000-000000000001', :'nev', true, 'because', 'manual', 'fs2');
\set ON_ERROR_STOP on
\echo '>>> backfill rule on a note that says free and a freight bill above zero'
insert into public.orders (organization_id, vendor_id, freight_notes, source, source_key) values ('00000000-0000-0000-0000-000000000001', :'nev', 'FREE @ $500', 'manual', 'fs3') returning id as o3 \gset
insert into public.orders (organization_id, vendor_id, freight_cost, source, source_key) values ('00000000-0000-0000-0000-000000000001', :'nev', 42.10, 'manual', 'fs4') returning id as o4 \gset
reset role;
update public.orders set free_shipping = true, free_shipping_basis = case when lower(freight_notes) ~ 'free ?@' then 'minimum_met' else 'other' end
 where free_shipping is null and freight_notes is not null and lower(freight_notes) ~ '(^|[^a-z])(free|f|yes)([^a-z?]|$)' and freight_notes not like '%?%' and coalesce(freight_cost, 0) = 0;
update public.orders set free_shipping = false where free_shipping is null and freight_cost > 0;
select free_shipping, free_shipping_basis from public.orders where id = :'o3';
select free_shipping from public.orders where id = :'o4';
