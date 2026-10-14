\set ON_ERROR_STOP on
\pset footer off
\echo '>>> I paid it: the WWD invoice is marked paid and the pay-by task is done'
reset role;
select set_config('request.jwt.claims', '', false) is not null as service;
insert into public.vendors (organization_id, name) values ('00000000-0000-0000-0000-000000000001', 'Pay Test Co') returning id as v \gset
insert into public.wwd_invoices (organization_id, seq, kind, wwd_date, wwd_vendor_name, vendor_id, amount, terms)
values ('00000000-0000-0000-0000-000000000001', 990001, 'invoice', current_date, 'PAY TEST CO', :'v', 100, '2% 30, NET 90') returning id as w \gset
insert into public.tasks (organization_id, title, assigned_to, vendor_id, auto_key) values ('00000000-0000-0000-0000-000000000001', 'Pay PAY TEST CO by soon for 2% off', '11111111-1111-1111-1111-111111111111', :'v', 'wwd:' || :'w' || ':30') returning id as t \gset
set role authenticated;
select set_config('request.jwt.claims', '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}', false) is not null as admin_in;
select public.task_mark_paid(:'t');
select public.org_set_pay_links('00000000-0000-0000-0000-000000000001', 'https://pay.example/edenred', null);
reset role;
select set_config('request.jwt.claims', '', false) is not null as service;
select w.sheet_paid_date = current_date as invoice_paid, w.note like 'Marked paid in VMS%' as noted, t.done_at is not null as task_done, t.done_note
  from public.wwd_invoices w, public.tasks t where w.id = :'w' and t.id = :'t';
select edenred_url, billcom_url from public.organizations where id = '00000000-0000-0000-0000-000000000001';
delete from public.tasks where id = :'t';
delete from public.wwd_invoices where id = :'w';
delete from public.vendors where id = :'v';
