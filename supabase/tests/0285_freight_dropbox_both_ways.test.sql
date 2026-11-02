\set ON_ERROR_STOP on
\pset footer off
\echo '>>> 0285: carrier folders and where a freight bill is in Dropbox'
reset role;
select set_config('request.jwt.claims', '', false) is not null as service;
insert into public.carriers (organization_id, name, role, dropbox_folder) values ('00000000-0000-0000-0000-000000000001', 'Carrier 0285', 'billing', 'UPS/{year}') returning id as c \gset
insert into public.freight_bills (organization_id, carrier_id, invoice_number, status, dropbox_path) values ('00000000-0000-0000-0000-000000000001', :'c', 'INV0285', 'to_match', '/x/Freight/UPS/2026/INV0285.pdf') returning id as b \gset
select (select dropbox_folder from public.carriers where id = :'c') = 'UPS/{year}' as folder_kept,
       (select dropbox_path from public.freight_bills where id = :'b') like '%/Freight/%' as path_kept,
       exists (select 1 from information_schema.columns where table_name = 'dropbox_connections' and column_name = 'watch_freight') as watch_column;
delete from public.freight_bills where id = :'b';
delete from public.carriers where id = :'c';
