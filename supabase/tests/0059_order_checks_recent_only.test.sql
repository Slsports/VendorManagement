\set ON_ERROR_STOP on
\pset footer off
\echo '>>> Order paperwork: old files and the bulk import are filed without a check'
reset role;
select id as v from public.vendors where name = 'Paperwork Test Co' \gset
insert into public.vendor_links (organization_id, vendor_id, kind, label, storage_path, source) values ('00000000-0000-0000-0000-000000000001', :'v', 'invoice', 'old import', 'x/old.pdf', 'import') returning id as d1 \gset
insert into public.vendor_links (organization_id, vendor_id, kind, label, storage_path, received_at) values ('00000000-0000-0000-0000-000000000001', :'v', 'confirmation', 'old upload', 'x/old2.pdf', '2023-04-01') returning id as d2 \gset
insert into public.vendor_links (organization_id, vendor_id, kind, label, storage_path, received_at) values ('00000000-0000-0000-0000-000000000001', :'v', 'confirmation', 'new upload', 'x/new.pdf', current_date) returning id as d3 \gset
select (select count(*) from public.order_checks where document_id in (:'d1', :'d2')) as old_checks, (select count(*) from public.order_checks where document_id = :'d3') as new_checks;
