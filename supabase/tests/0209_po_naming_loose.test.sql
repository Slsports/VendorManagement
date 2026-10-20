\set ON_ERROR_STOP on
\pset footer off
\echo '>>> Our PO naming as typed: vendor letters then the date fit; a bare number does not'
reset role;
select set_config('request.jwt.claims', '', false) is not null as service;
insert into public.vendors (organization_id, name) values ('00000000-0000-0000-0000-000000000001', 'PO209 LAZY ONE') returning id as v \gset
insert into public.orders (organization_id, vendor_id, status, order_date) values ('00000000-0000-0000-0000-000000000001', :'v', 'open', current_date) returning id as o \gset
insert into public.vendor_links (organization_id, vendor_id, kind, label, url) values ('00000000-0000-0000-0000-000000000001', :'v', 'confirmation', 'A', 'https://example.com/a') returning id as d1 \gset
insert into public.vendor_links (organization_id, vendor_id, kind, label, url) values ('00000000-0000-0000-0000-000000000001', :'v', 'confirmation', 'B', 'https://example.com/b') returning id as d2 \gset
insert into public.order_checks (organization_id, vendor_id, document_id, kind, status, order_id, po_number) values ('00000000-0000-0000-0000-000000000001', :'v', :'d1', 'confirmation', 'to_review', :'o', 'LAZY9226') returning id as c1 \gset
insert into public.order_checks (organization_id, vendor_id, document_id, kind, status, order_id, po_number) values ('00000000-0000-0000-0000-000000000001', :'v', :'d2', 'confirmation', 'to_review', :'o', '26569') returning id as c2 \gset
select public.po_check_state(:'c1') = 'fits' and public.po_check_state(:'c2') = 'off' as loose_naming;
delete from public.order_checks where vendor_id = :'v';
delete from public.vendor_links where vendor_id = :'v';
delete from public.orders where vendor_id = :'v';
delete from public.vendors where id = :'v';
