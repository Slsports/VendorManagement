\set ON_ERROR_STOP on
\pset footer off
\echo '>>> 0286: the duplicate check pairs a confirmation number with a PO a digit apart, and the same amount months apart'
reset role;
select set_config('request.jwt.claims', '', false) is not null as service;
insert into public.vendors (organization_id, name) values ('00000000-0000-0000-0000-000000000001', 'Dup 0286 Vendor') returning id as v \gset
insert into public.orders (organization_id, vendor_id, po_number, order_date, status, est_cost, description) values
  ('00000000-0000-0000-0000-000000000001', :'v', '297880', date '2026-02-04', 'paid', 1350, 'Boots with fur') returning id as a \gset
insert into public.orders (organization_id, vendor_id, po_number, order_date, status, est_cost, description) values
  ('00000000-0000-0000-0000-000000000001', :'v', 'B671841', date '2026-08-10', 'open', 1350, 'Emery II boots') returning id as b \gset
insert into public.vendor_links (organization_id, vendor_id, kind, label, order_id, doc_number, storage_path)
values ('00000000-0000-0000-0000-000000000001', :'v', 'confirmation', 'Confirmation 2978800', :'b', '2978800', 'test/0286.pdf');
select public.order_duplicate_scan('00000000-0000-0000-0000-000000000001') >= 1 as scanned;
select count(*) = 1 as card_made from public.review_items where kind = 'order_duplicate' and details->>'pair' in (:'a' || ':' || :'b', :'b' || ':' || :'a');
\echo '>>> a different amount far apart with no shared number stays alone'
insert into public.orders (organization_id, vendor_id, po_number, order_date, status, est_cost, description) values
  ('00000000-0000-0000-0000-000000000001', :'v', 'OTHER0286', date '2025-06-01', 'open', 99, 'Socks') returning id as c \gset
select public.order_duplicate_scan('00000000-0000-0000-0000-000000000001') is not null as rescanned;
select count(*) = 0 as no_card_for_other from public.review_items where kind = 'order_duplicate' and details::text like '%' || :'c' || '%';
delete from public.review_items where kind = 'order_duplicate' and (details->'a'->>'id' in (:'a', :'b', :'c') or details->'b'->>'id' in (:'a', :'b', :'c'));
delete from public.vendor_links where vendor_id = :'v';
delete from public.orders where vendor_id = :'v';
delete from public.vendors where id = :'v';
