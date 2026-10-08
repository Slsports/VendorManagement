\set ON_ERROR_STOP on
\pset footer off
\echo '>>> an imported document keeps its source; the year comes from the path season when given'
reset role;
insert into public.vendors (organization_id, name) values ('00000000-0000-0000-0000-000000000001', 'Import Docs Co') returning id as iv \gset
insert into public.vendor_links (organization_id, vendor_id, kind, label, storage_path, file_name, source, notes, doc_year)
values ('00000000-0000-0000-0000-000000000001', :'iv', 'invoice', 'INV 1', 'org/import/x.pdf', 'INV 1.pdf', 'import', 'Imported from Import Docs Co/Invoices/2019/INV 1.pdf', 2019)
returning source, doc_year;
