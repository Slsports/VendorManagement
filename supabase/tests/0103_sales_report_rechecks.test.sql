\set ON_ERROR_STOP on
\pset footer off
\echo '>>> A sales report filed for the vendor sends a confirmation with no order back to Claude'
reset role;
select set_config('request.jwt.claims', '', false) is not null as service;
insert into public.vendors (organization_id, name) values ('00000000-0000-0000-0000-000000000001', 'Recheck Sports') returning id as v \gset
insert into public.vendor_links (organization_id, vendor_id, kind, label, storage_path, file_name, received_at, source)
values ('00000000-0000-0000-0000-000000000001', :'v', 'confirmation', 'S9', 'x/S9.pdf', 'S9.pdf', current_date, 'email') returning id as doc \gset
update public.order_checks set status = 'needs_order', reading = '{"doc_type":"confirmation"}' where document_id = :'doc';
insert into public.vendor_links (organization_id, vendor_id, kind, label, storage_path, file_name, received_at, source)
values ('00000000-0000-0000-0000-000000000001', :'v', 'sales_report', 'RS Sales', 'x/rs.xlsx', 'rs.xlsx', current_date, 'manual');
select status from public.order_checks where document_id = :'doc';
delete from public.order_checks where vendor_id = :'v';
delete from public.vendor_links where vendor_id = :'v';
delete from public.vendors where id = :'v';
