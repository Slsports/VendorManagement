\set ON_ERROR_STOP on
\pset footer off
\echo '>>> 0300: the one freight company a paper names'
reset role;
insert into public.carriers (organization_id, name, role) values ('00000000-0000-0000-0000-000000000001', 'XPZ300 Freight', 'billing') returning id as c \gset
select public.carrier_for_name('00000000-0000-0000-0000-000000000001', 'XPZ300') = :'c' as by_start,
       public.carrier_for_name('00000000-0000-0000-0000-000000000001', 'Nobody 300') is null as nobody;
delete from public.carriers where id = :'c';
