\set ON_ERROR_STOP on
\pset footer off
\echo '>>> Freight allowance offered without an amount: flagged; existing amounts flagged too'
reset role;
insert into public.vendors (organization_id, name) values ('00000000-0000-0000-0000-000000000001', 'Allowancetest Tackle') returning id as av \gset
insert into public.orders (organization_id, vendor_id, est_cost, status, freight_allowance_offered) values ('00000000-0000-0000-0000-000000000001', :'av', 1546.60, 'open', true) returning id as ao \gset
select freight_allowance_offered, freight_allowance from public.orders where id = :'ao';
select count(*) filter (where freight_allowance is not null and not freight_allowance_offered) as amount_without_flag from public.orders;
