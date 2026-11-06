\set ON_ERROR_STOP on
\pset footer off
\echo '>>> 0315: SLS orders through a hardware supplier'
reset role;
select set_config('request.jwt.claims', '', false) is not null as service;
insert into public.vendors (organization_id, name, is_slh_vendor) values ('00000000-0000-0000-0000-000000000001', 'HW315 DIST', true) returning id as d \gset
insert into public.vendors (organization_id, name, aliases) values ('00000000-0000-0000-0000-000000000001', 'SLEDCOTEST', array['Sled Co Test']) returning id as b \gset

\echo '>>> a PO that names an SLS vendor: SLS order, tied to that vendor, still under the supplier'
insert into public.orders (organization_id, vendor_id, po_number, store_codes) values ('00000000-0000-0000-0000-000000000001', :'d', 'HWSLEDCOTEST11526', array['SLH']) returning id as o1 \gset
select vendor_id = :'d' and brand_vendor_id = :'b' and store_codes = array['SLS'] as sls_brand from public.orders where id = :'o1';

\echo '>>> a PO that says SLS: SLS order with no vendor tied'
insert into public.orders (organization_id, vendor_id, po_number, store_codes) values ('00000000-0000-0000-0000-000000000001', :'d', 'BBQSLS8526', array['SLH']) returning id as o2 \gset
select brand_vendor_id is null and store_codes = array['SLS'] as sls_only from public.orders where id = :'o2';

\echo '>>> the weekly hardware order stays SLH; several stores are left alone'
insert into public.orders (organization_id, vendor_id, po_number, store_codes) values ('00000000-0000-0000-0000-000000000001', :'d', 'EMERY110526', array['SLH']) returning id as o3 \gset
select brand_vendor_id is null and store_codes = array['SLH'] as weekly_slh from public.orders where id = :'o3';
insert into public.orders (organization_id, vendor_id, po_number, store_codes) values ('00000000-0000-0000-0000-000000000001', :'d', 'SLEDCOTEST11526', array['SLS', 'SLM']) returning id as o4 \gset
select store_codes = array['SLS', 'SLM'] and brand_vendor_id = :'b' as several_kept from public.orders where id = :'o4';

\echo '>>> an SLS vendor''s own orders are untouched'
insert into public.orders (organization_id, vendor_id, po_number, store_codes) values ('00000000-0000-0000-0000-000000000001', :'b', 'SLEDCOTEST11526', array['SLH']) returning id as o5 \gset
select brand_vendor_id is null and store_codes = array['SLH'] as direct_untouched from public.orders where id = :'o5';

\echo '>>> a merge moves the tie'
insert into public.vendors (organization_id, name) values ('00000000-0000-0000-0000-000000000001', 'SLEDCOTEST KEEP') returning id as k \gset
update public.vendors set merged_into_id = :'k' where id = :'b';
select brand_vendor_id = :'k' as merge_moves from public.orders where id = :'o1';

delete from public.orders where id in (:'o1', :'o2', :'o3', :'o4', :'o5');
delete from public.vendors where id in (:'b', :'k', :'d');
