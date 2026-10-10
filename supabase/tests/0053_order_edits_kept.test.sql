\set ON_ERROR_STOP on
\pset footer off
\echo '>>> A date changed in VMS survives an import; other fields still update'
reset role;
insert into public.vendors (organization_id, name) values ('00000000-0000-0000-0000-000000000001', 'Keeptest Co') returning id as v \gset
insert into public.orders (organization_id, vendor_id, status, order_date, notes) values ('00000000-0000-0000-0000-000000000001', :'v', 'entered', '2029-06-28', 'from sheet') returning id as o \gset
update public.orders set order_date = '2024-06-28' where id = :'o';
select edited_fields from public.orders where id = :'o';
begin;
select set_config('vms.import', 'on', true) is not null as importing;
update public.orders set order_date = '2029-06-28', notes = 'sheet again' where id = :'o';
commit;
select order_date, notes from public.orders where id = :'o';
