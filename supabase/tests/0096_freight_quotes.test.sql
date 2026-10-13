\set ON_ERROR_STOP on
\pset footer off
\echo '>>> Freight quotes: a quote on an order makes a task; picking the order and approving closes it'
reset role;
select set_config('request.jwt.claims', '', false) is not null as service;
update public.profiles set job_title = 'Receiving & Logistics' where id = '33333333-3333-3333-3333-333333333333';
insert into public.vendors (organization_id, name) values ('00000000-0000-0000-0000-000000000001', 'Quote Test Vendor') returning id as v \gset
insert into public.orders (organization_id, vendor_id, status, po_number, order_date, source) values ('00000000-0000-0000-0000-000000000001', :'v', 'confirmed', 'QT12345', current_date, 'email') returning id as o \gset
insert into public.email_threads (organization_id, gmail_thread_id) values ('00000000-0000-0000-0000-000000000001', 'fq-t1') returning id as t \gset
insert into public.emails (organization_id, thread_id, gmail_id, direction, from_email, subject, body_text, received_at, vendor_id)
values ('00000000-0000-0000-0000-000000000001', :'t', 'fq-1', 'in', 'ship@quote.example', 'Freight quote', '3 cartons', timestamptz '2026-10-16 10:00 America/Los_Angeles', :'v') returning id as e \gset
select public.freight_quote_apply(:'e', true, '{"carrier":"UPS Ground","cost":"84.20","details":{"cartons":3}}', :'v', null, null) as q \gset
select q.status, t.title, t.due_date, t.assigned_to = '33333333-3333-3333-3333-333333333333' as trevor from public.freight_quotes q join public.tasks t on t.id = q.task_id where q.id = :'q';
\echo '>>> as a buyer: pick the order, add our prices, approve WWEX'
set role authenticated;
select set_config('request.jwt.claims', '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}', false) is not null as signed_in;
select public.freight_quote_action(:'q', 'set_order', :'o');
select public.freight_quote_action(:'q', 'ours', null, 96.50, 71.10);
select public.freight_quote_action(:'q', 'approve', null, null, null, null, 'wwex');
reset role;
select set_config('request.jwt.claims', '', false) is not null as service;
select q.status, q.approved_cost, t.title, t.done_at is not null as task_done, o.freight_cost from public.freight_quotes q join public.tasks t on t.id = q.task_id join public.orders o on o.id = q.order_id where q.id = :'q';
delete from public.tasks where auto_key = 'freight_quote:' || :'q';
delete from public.freight_quotes where id = :'q';
delete from public.emails where gmail_id like 'fq-%';
delete from public.email_threads where id = :'t';
delete from public.ls_pos where order_id = :'o';
delete from public.orders where id = :'o';
delete from public.vendors where id = :'v';
