\set ON_ERROR_STOP on
\pset footer off
\echo '>>> Moving a file out of Invoices sets its check aside; moving it back starts it again'
reset role;
select id as v from public.vendors where name = 'Paperwork Test Co' \gset
insert into public.vendor_links (organization_id, vendor_id, kind, label, storage_path, received_at) values ('00000000-0000-0000-0000-000000000001', :'v', 'invoice', 'moved', 'x/mv.pdf', current_date) returning id as d \gset
update public.vendor_links set kind = 'image' where id = :'d';
select status, read_note from public.order_checks where document_id = :'d';
update public.vendor_links set kind = 'confirmation' where id = :'d';
select status, kind from public.order_checks where document_id = :'d';
