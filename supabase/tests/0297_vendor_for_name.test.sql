\set ON_ERROR_STOP on
\pset footer off
\echo '>>> 0297: the one vendor a paper names'
reset role;
insert into public.vendors (organization_id, name, aliases) values ('00000000-0000-0000-0000-000000000001', 'NAMED 297 SPORTS', array['N297 SPORTS INC']) returning id as v \gset
select public.vendor_for_name('00000000-0000-0000-0000-000000000001', 'Named 297 Sports Inc') = :'v' as by_name,
       public.vendor_for_name('00000000-0000-0000-0000-000000000001', 'N297 Sports, Inc.') = :'v' as by_alias,
       public.vendor_for_name('00000000-0000-0000-0000-000000000001', 'Nobody 297') is null as nobody;
delete from public.vendors where id = :'v';
