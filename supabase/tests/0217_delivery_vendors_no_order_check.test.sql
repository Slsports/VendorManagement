\set ON_ERROR_STOP on
\pset footer off
\echo '>>> Delivery vendors: their invoices are filed with no order check'
reset role;
select set_config('request.jwt.claims', '', false) is not null as service;
insert into public.vendors (organization_id, name, is_delivery_vendor) values ('00000000-0000-0000-0000-000000000001', 'DELIV217', true) returning id as d \gset
insert into public.vendors (organization_id, name) values ('00000000-0000-0000-0000-000000000001', 'ORDER217') returning id as o \gset
insert into public.vendor_links (organization_id, vendor_id, kind, label, storage_path) values ('00000000-0000-0000-0000-000000000001', :'d', 'invoice', 'Inv', 'x/d217.pdf');
insert into public.vendor_links (organization_id, vendor_id, kind, label, storage_path) values ('00000000-0000-0000-0000-000000000001', :'o', 'invoice', 'Inv', 'x/o217.pdf');
select not exists (select 1 from public.order_checks where vendor_id = :'d') and exists (select 1 from public.order_checks where vendor_id = :'o') as delivery_skipped;
delete from public.order_checks where vendor_id in (:'d', :'o');
delete from public.vendor_links where vendor_id in (:'d', :'o');
delete from public.vendors where id in (:'d', :'o');
