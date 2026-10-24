\set ON_ERROR_STOP on
\pset footer off
\echo '>>> Every order gets our PO: code + order date, -2 the same day, typed wins, follows the date, retail stores keep theirs'
reset role;
select set_config('request.jwt.claims', '', false) is not null as service;
insert into public.vendors (organization_id, name, po_code, email) values ('00000000-0000-0000-0000-000000000001', 'PO234 OKUMA', 'OKUMA', 'po234@example.com') returning id as v \gset
insert into public.vendors (organization_id, name, is_retail_store) values ('00000000-0000-0000-0000-000000000001', 'PO234 BIGBOX', true) returning id as r \gset
insert into public.orders (organization_id, vendor_id, status, order_date) values ('00000000-0000-0000-0000-000000000001', :'v', 'open', '2026-09-01') returning id as o1 \gset
insert into public.orders (organization_id, vendor_id, status, order_date, po_number) values ('00000000-0000-0000-0000-000000000001', :'v', 'open', '2026-09-01', 'N/A') returning id as o2 \gset
insert into public.orders (organization_id, vendor_id, status, order_date, po_number) values ('00000000-0000-0000-0000-000000000001', :'v', 'open', '2026-09-01', 'OKUMA-SHOW') returning id as o3 \gset
insert into public.orders (organization_id, vendor_id, status, order_date) values ('00000000-0000-0000-0000-000000000001', :'r', 'open', '2026-09-01') returning id as o4 \gset
select (select po_number = 'OKUMA090126' and po_auto from public.orders where id = :'o1')
   and (select po_number = 'OKUMA090126-2' and po_auto from public.orders where id = :'o2')
   and (select po_number = 'OKUMA-SHOW' and not po_auto from public.orders where id = :'o3')
   and (select po_number is null from public.orders where id = :'o4') as new_orders_get_ours;
-- a VMS-made PO follows the order date until a paper comes in; a typed one stays
update public.orders set order_date = '2026-09-03' where id in (:'o1', :'o3');
select (select po_number = 'OKUMA090326' from public.orders where id = :'o1') and (select po_number = 'OKUMA-SHOW' from public.orders where id = :'o3') as follows_the_date;
update public.orders set po_number = 'OKUMA9326' where id = :'o1';
select po_number = 'OKUMA9326' and not po_auto as typed_wins from public.orders where id = :'o1';
update public.orders set po_number = '' where id = :'o1';
select po_number = 'OKUMA090326' and po_auto as cleared_gets_ours from public.orders where id = :'o1';

-- ours written another way counts as ours
select public.po_same('OKUMA9126', 'OKUMA090126') and public.po_same('planet101926', 'PLANETCOTTON101926') and public.po_same('LAZY9226', 'LAZYONE090226')
   and not public.po_same('OKUMA9127', 'OKUMA090126') and not public.po_same('WW Show 9-2026', 'SONA090226') and not public.po_same(null, 'OKUMA090126') as written_another_way;
insert into public.vendor_links (organization_id, vendor_id, kind, label, url) values ('00000000-0000-0000-0000-000000000001', :'v', 'confirmation', 'C1', 'https://example.com/234') returning id as d1 \gset
insert into public.order_checks (organization_id, vendor_id, document_id, kind, status, order_id, po_number, reading, doc_date) values
  ('00000000-0000-0000-0000-000000000001', :'v', :'d1', 'confirmation', 'to_review', :'o1', 'Okuma 9326', '{"po_number":"Okuma 9326"}', current_date) returning id as c \gset
select public.po_check_state(:'c') = 'ours' and public.order_check_po_followup(:'c') is null as ours_needs_nothing;
-- with a paper in, a date change no longer moves the PO
update public.orders set order_date = '2026-09-04' where id = :'o1';
select po_number = 'OKUMA090326' as kept_once_papers_came from public.orders where id = :'o1';

delete from public.order_checks where vendor_id = :'v';
delete from public.vendor_links where vendor_id = :'v';
delete from public.orders where vendor_id in (:'v', :'r');
delete from public.vendors where id in (:'v', :'r');
