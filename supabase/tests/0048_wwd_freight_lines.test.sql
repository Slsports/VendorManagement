\set ON_ERROR_STOP on
\pset footer off
\echo '>>> WWD freight lines: XPO files itself to the freight company; the vendor comes from the delivery receipt PRO'
reset role;
insert into public.carriers (organization_id, name, role) values ('00000000-0000-0000-0000-000000000001', 'XPOTEST', 'trucking') returning id as xc \gset
insert into public.vendors (organization_id, name) values ('00000000-0000-0000-0000-000000000001', 'Protest Toys') returning id as pv \gset
insert into public.email_threads (organization_id, gmail_thread_id) values ('00000000-0000-0000-0000-000000000001', 'protest-thread') returning id as th \gset
insert into public.emails (organization_id, gmail_id, thread_id, direction, received_at) values ('00000000-0000-0000-0000-000000000001', 'protest-1', :'th', 'in', now()) returning id as em \gset
insert into public.delivery_receipts (organization_id, carrier_id, email_id, pro_number, shipper_name, vendor_id, status)
  values ('00000000-0000-0000-0000-000000000001', :'xc', :'em', '711-027940', 'PROTEST TOYS', :'pv', 'filed');
select public.wwd_carrier_for('00000000-0000-0000-0000-000000000001', 'XPOTEST Logistics Freight, Inc') = :'xc' as xpo_by_prefix;
select id as admin_id from public.profiles where organization_id = '00000000-0000-0000-0000-000000000001' and role = 'admin' and is_active order by created_at limit 1 \gset
set role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', :'admin_id', 'role', 'authenticated')::text, false) is not null as as_admin;
select public.wwd_import('{"invoices":[{"seq":"7311199","kind":"invoice","vendor_name":"XPOTEST LOGISTICS FREIGHT, INC","vendor_invoice_number":"711027940","amount":592.94,"wwd_date":"2026-03-19","source":"edenred"},{"seq":"5859799","kind":"invoice","vendor_name":"Shiptest Freight Co","amount":100,"wwd_date":"2024-04-23","source":"sheet","sheet_paid_date":"2024-05-18"}]}'::jsonb)->'invoices_new' as new;
select public.wwd_assign_name_carrier('Shiptest Freight Co', :'xc') as moved;
select ref is null as pending, pay_date, total, lines, vendors from public.wwd_payment_list() where pay_date = '2024-05-18';
reset role;
select i.seq, c.name as carrier, v.name as vendor from public.wwd_invoices i left join public.carriers c on c.id = i.carrier_id left join public.vendors v on v.id = i.vendor_id where i.seq in ('7311199', '5859799') order by i.seq;
select 'Shiptest Freight Co' = any (aliases) as alias_added from public.carriers where id = :'xc';
