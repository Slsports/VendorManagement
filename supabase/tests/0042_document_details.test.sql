\set ON_ERROR_STOP on
\pset footer off
\echo '>>> a scanned invoice keeps its number, date and total; the date sets the year folder'
reset role;
insert into public.vendors (organization_id, name) values ('00000000-0000-0000-0000-000000000001', 'Scan Docs Co') returning id as sv \gset
insert into public.vendor_links (organization_id, vendor_id, kind, label, storage_path, file_name, source, doc_number, doc_date, doc_total, doc_year)
values ('00000000-0000-0000-0000-000000000001', :'sv', 'invoice', 'Invoice 12345', 'x/s.pdf', 's.pdf', 'import', '12345', '2012-03-04', 812.40, 2012)
returning doc_number, doc_date, doc_total, doc_year;
