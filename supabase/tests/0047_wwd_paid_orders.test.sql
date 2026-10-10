\set ON_ERROR_STOP on
\pset footer off
\echo '>>> WWD invoices tie to an order already paid on the sheet; its freight-allowance credit marks it received'
reset role;
insert into public.vendors (organization_id, name) values ('00000000-0000-0000-0000-000000000001', 'Paidtest Water Toys') returning id as pv \gset
insert into public.orders (organization_id, vendor_id, est_cost, status, paid_date, freight_allowance_offered, freight_allowance)
  values ('00000000-0000-0000-0000-000000000001', :'pv', 2768.59, 'paid', '2024-06-03', true, 579.25) returning id as po \gset
select id as admin_id from public.profiles where organization_id = '00000000-0000-0000-0000-000000000001' and role = 'admin' and is_active order by created_at limit 1 \gset
set role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', :'admin_id', 'role', 'authenticated')::text, false) is not null as as_admin;
select public.wwd_import('{"invoices":[{"seq":"8918436","kind":"invoice","vendor_name":"Paidtest Water Toys","amount":2768.59,"wwd_date":"2024-05-29","source":"sheet"}],"payments":[{"ref":"PBT1","pay_date":"2024-07-26","total":-579.25}],"lines":[{"ref":"PBT1","pay_date":"2024-07-26","seq":"8918436","amount":-579.25,"wwd_date":"2024-07-15"}]}'::jsonb)->'orders_paid' as orders_paid;
reset role;
select (select count(*) from public.wwd_invoices where order_id = :'po') as invoices_on_order, freight_allowance_received from public.orders where id = :'po';
