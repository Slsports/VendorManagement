\set ON_ERROR_STOP on
\pset footer off
\echo '>>> Bill.com payments: a PartnerShip invoice and a vendor order match; import marks them paid once'
reset role;
select id as ps from public.carriers where organization_id = '00000000-0000-0000-0000-000000000001' and name = 'PartnerShip' \gset
insert into public.freight_bills (organization_id, carrier_id, invoice_number, total, status) values ('00000000-0000-0000-0000-000000000001', :'ps', 'PS00618480', 156.86, 'to_match') returning id as fb \gset
insert into public.vendors (organization_id, name) values ('00000000-0000-0000-0000-000000000001', 'Billcom Toys') returning id as bv \gset
insert into public.orders (organization_id, vendor_id, final_cost, status) values ('00000000-0000-0000-0000-000000000001', :'bv', 2639.50, 'entered') returning id as bo \gset
select payee_key('PartnerShip LLC') as a, payee_key('Priority One, Inc.') as b;
select id as admin_id from public.profiles where organization_id = '00000000-0000-0000-0000-000000000001' and role = 'admin' and is_active order by created_at limit 1 \gset
set role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', :'admin_id', 'role', 'authenticated')::text, false) is not null as as_admin;
select e->>'carrier' as carrier, e->>'bill' as bill, e->>'vendor' as vendor, (e->>'order_id') is not null as has_order
  from jsonb_array_elements(public.billcom_preview('[{"payee":"PartnerShip LLC","invoice_number":"PS00618480","amount":156.86,"confirmation":"P1"},{"payee":"Billcom Toys Inc.","invoice_number":"Multiple","amount":2639.50,"confirmation":"P2"}]'::jsonb)) e;
select public.billcom_import('[{"payee":"PartnerShip LLC","invoice_number":"PS00618480","amount":156.86,"confirmation":"P1","process_date":"2026-08-01","method":"ePayment"},{"payee":"Billcom Toys Inc.","invoice_number":"Multiple","amount":2639.50,"confirmation":"P2","process_date":"2026-09-21"}]'::jsonb) as imported;
select public.billcom_import('[{"payee":"PartnerShip LLC","invoice_number":"PS00618480","amount":156.86,"confirmation":"P1","process_date":"2026-08-01"}]'::jsonb) as again;
reset role;
select paid_date, paid_via, paid_ref from public.freight_bills where id = :'fb';
select paid_date, paid_via, status from public.orders where id = :'bo';
