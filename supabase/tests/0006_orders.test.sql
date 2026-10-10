\set ON_ERROR_STOP on
\pset footer off
\echo '>>> orders: buyer creates an order; status change logs history; viewer reads only'
set role authenticated;
select set_config('request.jwt.claims', '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}', false);
insert into public.vendors (organization_id, name) values ('00000000-0000-0000-0000-000000000001', 'Order Test Vendor') returning id as otv \gset
insert into public.orders (organization_id, vendor_id, status, order_date, season, store_codes, est_cost, description, source, source_key)
  values ('00000000-0000-0000-0000-000000000001', :'otv', 'entered', '2026-08-26', 'summer', '{SLS}', 1234.50, 'FISHING TACKLE', 'order_guide', 'k1') returning id as ord \gset
update public.orders set status = 'paid', paid_date = '2026-10-01', paid_via = 'wwd' where id = :'ord';
select from_status, to_status from public.order_status_history where order_id = :'ord' order by changed_at;
\echo '>>> same source key twice must FAIL'
\set ON_ERROR_STOP off
insert into public.orders (organization_id, vendor_id, source, source_key) values ('00000000-0000-0000-0000-000000000001', :'otv', 'order_guide', 'k1');
\set ON_ERROR_STOP on
\echo '>>> an invoice attached to the order'
insert into public.vendor_links (organization_id, vendor_id, order_id, kind, label, url) values ('00000000-0000-0000-0000-000000000001', :'otv', :'ord', 'invoice', 'Invoice 123', 'https://example.com/inv.pdf') returning kind;
\echo '>>> merging the vendor away carries the order'
insert into public.vendors (organization_id, name) values ('00000000-0000-0000-0000-000000000001', 'Order Test Vendor Kept') returning id as kept \gset
select public.merge_vendors(:'kept', :'otv') = :'kept'::uuid as merged;
select vendor_id = :'kept'::uuid as order_moved from public.orders where id = :'ord';
select vendor_id = :'kept'::uuid as doc_moved from public.vendor_links where order_id = :'ord';
select set_config('request.jwt.claims', '{"sub":"44444444-4444-4444-4444-444444444444","role":"authenticated"}', false);
select count(*) as viewer_sees from public.orders where id = :'ord';
update public.orders set notes = 'x' where id = :'ord';
select notes from public.orders where id = :'ord';
reset role;
