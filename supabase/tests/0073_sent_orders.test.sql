\set ON_ERROR_STOP on
\pset footer off
\echo '>>> Sent orders: a confirmation waiting for its order finds it once the order is added'
reset role;
insert into public.vendors (organization_id, name) values ('00000000-0000-0000-0000-000000000001', 'Sent Orders Test Vendor') returning id as v \gset
insert into public.vendor_links (organization_id, vendor_id, kind, label, storage_path, file_name) values ('00000000-0000-0000-0000-000000000001', :'v', 'other', 'conf', 'x/y.pdf', 'y.pdf') returning id as d \gset
insert into public.order_checks (organization_id, vendor_id, kind, document_id, status, po_number, doc_total, doc_date)
values ('00000000-0000-0000-0000-000000000001', :'v', 'confirmation', :'d', 'needs_order', 'MACKS-092326', 600.77, current_date) returning id as c \gset
select public.order_checks_refind('00000000-0000-0000-0000-000000000001', :'v') as found_before;
insert into public.orders (organization_id, vendor_id, status, po_number, est_cost, order_date, source) values ('00000000-0000-0000-0000-000000000001', :'v', 'open', 'MACKS092326', 600.77, current_date - 1, 'email') returning id as o \gset
select public.order_checks_refind('00000000-0000-0000-0000-000000000001', :'v') as found_after;
select status, order_id = :'o' as linked from public.order_checks where id = :'c';
delete from public.order_checks where id = :'c';
delete from public.vendor_links where id = :'d';
delete from public.orders where id = :'o';
delete from public.vendors where id = :'v';
