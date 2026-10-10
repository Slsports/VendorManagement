\set ON_ERROR_STOP on
\pset footer off
\echo '>>> a vendor on Prepaid Direct paid by ACH; an order paid via ACH'
reset role;
insert into public.vendors (organization_id, name) values ('00000000-0000-0000-0000-000000000001', 'Prepaid Test Co') returning id as pv \gset
insert into public.vendor_billing_routes (vendor_id, route, is_default, pay_method) values (:'pv', 'prepaid_direct', true, 'ach') returning route, pay_method;
insert into public.orders (organization_id, vendor_id, paid_via) values ('00000000-0000-0000-0000-000000000001', :'pv', 'ach') returning paid_via;
