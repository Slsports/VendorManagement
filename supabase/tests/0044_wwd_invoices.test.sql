\set ON_ERROR_STOP on
\pset footer off
\echo '>>> WWD invoices: EdenRed + payment sheet + Payment History build one invoice each; vendors, credits, fee, orders paid'
reset role;
insert into public.vendors (organization_id, name)
select '00000000-0000-0000-0000-000000000001', 'WORLDWIDE' where not exists (select 1 from public.vendors where organization_id = '00000000-0000-0000-0000-000000000001' and upper(name) = 'WORLDWIDE');
insert into public.vendors (organization_id, name) values ('00000000-0000-0000-0000-000000000001', 'Wwdtest Toys') returning id as wv \gset
insert into public.vendors (organization_id, name) values ('00000000-0000-0000-0000-000000000001', 'Continuumtest Games') returning id as cv \gset
insert into public.orders (organization_id, vendor_id, est_cost, po_number, status) values ('00000000-0000-0000-0000-000000000001', :'wv', 480.00, 'WT-8/1/26', 'entered') returning id as wo \gset
insert into public.orders (organization_id, vendor_id, est_cost, status, freight_allowance_offered, freight_allowance, freight_allowance_pay_by)
  values ('00000000-0000-0000-0000-000000000001', :'cv', 1169.83, 'entered', true, 147.83, '2026-07-16') returning id as co \gset
select public.wwd_kind('1773414', 275, null, null) as fee, public.wwd_kind('1773414', 275, 'invoice', 'WWD DUES') as dues, public.wwd_kind('7428960', -169.77, null, null) as credit, public.wwd_kind('6931706', 30, 'debit', null) as debit;
select id as admin_id from public.profiles where organization_id = '00000000-0000-0000-0000-000000000001' and role = 'admin' and is_active order by created_at limit 1 \gset
set role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', :'admin_id', 'role', 'authenticated')::text, false) is not null as as_admin;

\set payload '{"invoices":[{"seq":"07000001","kind":"invoice","vendor_name":"WWDTEST TOYS INC","po_number":"WT 8/1/26","vendor_invoice_number":"INV-55","amount":500,"wwd_date":"2026-08-03","source":"edenred"},{"seq":"7000001","vendor_name":"Wwdtest Toys","amount":500,"discount":20,"wwd_date":"2026-08-03","source":"sheet"},{"seq":"7000002","kind":"invoice","vendor_name":"Continuumtest Games Inc","amount":1169.83,"wwd_date":"2026-05-17","source":"sheet"},{"seq":"1700001","amount":275,"wwd_date":"2026-08-31","source":"sheet"},{"seq":"863752","vendor_name":"Wwdtest Toys","amount":1296,"source":"scan"},{"seq":"7000003","vendor_name":"Mysterytest Co","amount":99.06,"source":"sheet","sheet_paid_date":"2026-06-03"}],"payments":[{"ref":"PB1","pay_date":"2026-09-15","total":1924.83},{"ref":"PB2","pay_date":"2026-12-27","total":-147.83}],"lines":[{"ref":"PB1","pay_date":"2026-09-15","seq":"7000001","amount":480,"wwd_date":"2026-08-03"},{"ref":"PB1","pay_date":"2026-09-15","seq":"1700001","amount":275,"wwd_date":"2026-08-31"},{"ref":"PB1","pay_date":"2026-09-15","seq":"7000002","amount":1169.83,"wwd_date":"2026-05-17"},{"ref":"PB2","pay_date":"2026-12-27","seq":"7000002","amount":-147.83,"wwd_date":"2026-12-13"},{"ref":"PB2","pay_date":"2026-12-27","seq":"6863752","amount":1296,"wwd_date":"2026-12-13"}]}'
select p->'invoices' as invoices, p->'invoices_new' as new, p->'payments_new' as pays, jsonb_array_length(p->'names') as names
  from (select public.wwd_preview(:'payload'::jsonb) as p) x;
select public.wwd_import(:'payload'::jsonb) - 'no_vendor' - 'linked_orders' as first_import;
select public.wwd_import(:'payload'::jsonb) - 'no_vendor' - 'linked_orders' as again;
reset role;
select i.seq, i.kind, v.name as vendor, i.order_id is not null as has_order, i.paid_amount, i.paid_date, i.discount, i.vendor_invoice_number, i.sources
  from public.wwd_invoices i left join public.vendors v on v.id = i.vendor_id
 where i.seq in ('7000001', '7000002', '1700001', '7000003', '6863752', '863752') order by i.seq, i.kind;
select status, paid_date, paid_via, paid_ref from public.orders where id = :'wo';
select status, paid_date, freight_allowance_received from public.orders where id = :'co';

\echo '>>> WWD invoices: a person names the vendor behind a spelling; it becomes an alias'
set role authenticated;
select public.wwd_assign_name('Mysterytest Co', :'wv') as moved;
reset role;
select 'Mysterytest Co' = any (aliases) as alias_added from public.vendors where id = :'wv';
select v.name from public.wwd_invoices i join public.vendors v on v.id = i.vendor_id where i.seq = '7000003';
