\set ON_ERROR_STOP on
\pset footer off
\echo '>>> Sales reports folder kind'
reset role;
insert into public.vendor_links (organization_id, vendor_id, kind, label, storage_path) select '00000000-0000-0000-0000-000000000001', id, 'sales_report', 'DP sales', 'x/sales.xlsx' from public.vendors where name = 'Paperwork Test Co' returning kind;
