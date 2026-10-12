\set ON_ERROR_STOP on
\pset footer off
\echo '>>> a staff email asking for supplies: a request and a task due in 2 days'
reset role;
select id as admin_id from public.profiles where role = 'admin' and organization_id = '00000000-0000-0000-0000-000000000001' order by created_at limit 1 \gset
insert into public.email_senders (organization_id, sender_key, kind) values ('00000000-0000-0000-0000-000000000001', 'staff@supplytest.example', 'internal') returning id as ss \gset
insert into public.email_threads (organization_id, gmail_thread_id) values ('00000000-0000-0000-0000-000000000001', 'sut1') returning id as st \gset
insert into public.emails (organization_id, gmail_id, thread_id, direction, from_email, from_name, subject, body_text, received_at, sender_id)
values ('00000000-0000-0000-0000-000000000001', 'sum1', :'st', 'in', 'staff@supplytest.example', 'Annie', 'Office Supplies', 'We need bubble wrap and register tape', now(), :'ss') returning id as se \gset
select count(*) as queued from public.supply_request_queue('00000000-0000-0000-0000-000000000001') where email_id = :'se';
select public.supply_from_email(:'se', true, 'Bubble wrap, cash register tape', '[{"name":"Bubble wrap"},{"name":"Cash register tape"}]', 'Annie', null, false) as req \gset
select status, requested_by_name, requested_by_email from public.supply_requests where id = :'req';
select title, due_date = current_date + 2 as due_in_2, assigned_to = :'admin_id' as for_admin from public.tasks where auto_key = 'supply:' || :'req';
\echo '>>> the order confirmation: ordered, where, arrival, task done, requester to email'
insert into public.email_threads (organization_id, gmail_thread_id) values ('00000000-0000-0000-0000-000000000001', 'sut2') returning id as ct \gset
insert into public.emails (organization_id, gmail_id, thread_id, direction, from_email, subject, body_text, received_at)
values ('00000000-0000-0000-0000-000000000001', 'sum2', :'ct', 'in', 'auto@shop.example', 'Your order confirmation', 'Bubble wrap x2, register tape', now() + interval '1 minute') returning id as ce \gset
select count(*) as conf_queued from public.supply_confirmation_queue('00000000-0000-0000-0000-000000000001') where email_id = :'ce';
select public.supply_from_confirmation(:'ce', 'confirmation', array[:'req']::uuid[], 'Shop', '123-456', current_date + 4, 42.10, null) as matched;
select status, ordered_from, order_number, expected_at = current_date + 4 as expected, notify_pending from public.supply_requests where id = :'req';
select done_note from public.tasks where auto_key = 'supply:' || :'req';
select count(*) as to_email from public.supply_notify_queue('00000000-0000-0000-0000-000000000001') where id = :'req';
select public.supply_notified(:'req', 'Hi Annie…', null);
select notify_pending, notified_at is not null as emailed from public.supply_requests where id = :'req';
\echo '>>> an old request gets no task and no email'
insert into public.emails (organization_id, gmail_id, thread_id, direction, from_email, subject, body_text, received_at, sender_id)
values ('00000000-0000-0000-0000-000000000001', 'sum3', :'st', 'in', 'staff@supplytest.example', 'Label tape', 'Need label tape', now() - interval '90 days', :'ss') returning id as oe \gset
select public.supply_from_email(:'oe', true, 'Label machine tape', null, 'Annie', null, true) as old_req \gset
select task_id is null as no_task, is_old from public.supply_requests where id = :'old_req';
\echo '>>> by hand: New request, then mark it arrived'
set role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', :'admin_id', 'role', 'authenticated')::text, false);
select public.supply_add('00000000-0000-0000-0000-000000000001', 'Price gun labels', 'Trevor') as hand \gset
select public.supply_set(:'hand', 'arrived');
reset role;
select status, arrived_at is not null as arrived from public.supply_requests where id = :'hand';
select done_at is not null as task_done from public.tasks where auto_key = 'supply:' || :'hand';
