\set ON_ERROR_STOP on
\pset footer off
\echo '>>> Web-order vendors: a confirmation is done on reading and confirms its order; others still compare'
reset role;
select set_config('request.jwt.claims', '', false) is not null as service;
insert into public.vendors (organization_id, name, web_orders) values ('00000000-0000-0000-0000-000000000001', 'Web Order Test Vendor', true) returning id as v \gset
insert into public.vendors (organization_id, name) values ('00000000-0000-0000-0000-000000000001', 'Regular Test Vendor') returning id as r \gset
insert into public.orders (organization_id, vendor_id, status, po_number, order_date, source) values ('00000000-0000-0000-0000-000000000001', :'v', 'open', 'W123', current_date, 'email') returning id as o \gset
insert into public.orders (organization_id, vendor_id, status, po_number, order_date, source) values ('00000000-0000-0000-0000-000000000001', :'r', 'open', 'R123', current_date, 'email') returning id as o2 \gset
insert into public.vendor_links (organization_id, vendor_id, kind, label, storage_path, file_name) values ('00000000-0000-0000-0000-000000000001', :'v', 'confirmation', 'conf', 'x/w.pdf', 'w.pdf') returning id as d \gset
insert into public.vendor_links (organization_id, vendor_id, kind, label, storage_path, file_name) values ('00000000-0000-0000-0000-000000000001', :'r', 'confirmation', 'conf', 'x/r.pdf', 'r.pdf') returning id as d2 \gset
select public.order_check_apply_read((select id from public.order_checks where document_id = :'d'), '{"doc_type":"confirmation","po_number":"W123","total":"50"}') as web_read,
       public.order_check_apply_read((select id from public.order_checks where document_id = :'d2'), '{"doc_type":"confirmation","po_number":"R123","total":"50"}') as regular_read;
select c.status, c.outcome, o.status as order_status from public.order_checks c join public.orders o on o.id = c.order_id where c.document_id = :'d';
select status from public.order_checks where document_id = :'d2';
delete from public.ls_pos where order_id in (:'o', :'o2');
delete from public.order_checks where document_id in (:'d', :'d2');
delete from public.vendor_links where id in (:'d', :'d2');
delete from public.orders where id in (:'o', :'o2');
delete from public.vendors where id in (:'v', :'r');
