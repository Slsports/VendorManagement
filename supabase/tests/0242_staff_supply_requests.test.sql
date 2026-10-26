\set ON_ERROR_STOP on
\pset footer off
\echo '>>> Supply requests from our own work addresses; orders@, the admin and former staff skipped; late requests re-read confirmations'
reset role;
select set_config('request.jwt.claims', '', false) is not null as service;
select mailbox as box from public.mail_accounts where organization_id = '00000000-0000-0000-0000-000000000001' \gset
select email as admin_email from public.profiles where id = public.org_admin('00000000-0000-0000-0000-000000000001') \gset
insert into public.email_senders (organization_id, sender_key, kind, skip_supply_requests) values ('00000000-0000-0000-0000-000000000001', 'gone242@ourshop.example', 'internal', true);
insert into public.email_threads (organization_id, gmail_thread_id) values ('00000000-0000-0000-0000-000000000001', 'sup242') returning id as t \gset
insert into public.emails (organization_id, gmail_id, thread_id, direction, from_email, from_name, subject, body_text, received_at) values
  ('00000000-0000-0000-0000-000000000001', 'sup242-1', :'t', 'internal', 'annie242@ourshop.example', 'Annie', 'SLS New Order', 'We need index card pockets', now() - interval '5 days'),
  ('00000000-0000-0000-0000-000000000001', 'sup242-2', :'t', 'internal', :'box', 'Orders', 'Re: SLS New Order', 'What size?', now() - interval '5 days'),
  ('00000000-0000-0000-0000-000000000001', 'sup242-3', :'t', 'internal', :'admin_email', 'Dana', 'Fwd: supplies', 'Fwd from Jane', now() - interval '5 days'),
  ('00000000-0000-0000-0000-000000000001', 'sup242-4', :'t', 'internal', 'gone242@ourshop.example', 'Gone', 'Supplies', 'We need tape', now() - interval '5 days');
select id as e1 from public.emails where gmail_id = 'sup242-1' \gset

-- only the staff work email is queued
select array_agg(q.from_email order by q.from_email) = array['annie242@ourshop.example'] as only_staff
  from public.supply_request_queue('00000000-0000-0000-0000-000000000001', 500) q where q.email_id in (select id from public.emails where thread_id = :'t');

-- an order confirmation that came in (and was read) before the request was found
insert into public.emails (organization_id, gmail_id, thread_id, direction, from_email, subject, body_text, received_at, supply_conf_read_at)
values ('00000000-0000-0000-0000-000000000001', 'sup242-5', :'t', 'in', 'auto@shop242.example', 'Your order confirmation', 'Index card pockets x10', now() - interval '4 days', now() - interval '4 days') returning id as c \gset
select public.supply_from_email(:'e1', true, 'Index card pockets', '[{"name":"Index card pockets"}]', 'Annie', null, false) as req \gset
select supply_conf_read_at is null as confirmation_read_again from public.emails where id = :'c';
select remind_at >= now() + interval '29 minutes' as reminds_after_the_read from public.tasks where auto_key = 'supply:' || :'req';
-- it fills the request, but Annie isn't emailed about a 4-day-old confirmation
select public.supply_from_confirmation(:'c', 'confirmation', array[:'req']::uuid[], 'Shop', '242', null, null, null) = 1 as matched;
select status = 'ordered' and not notify_pending as ordered_no_email from public.supply_requests where id = :'req';
select done_at is not null as task_done from public.tasks where auto_key = 'supply:' || :'req';

delete from public.tasks where auto_key = 'supply:' || :'req';
delete from public.supply_requests where id = :'req';
delete from public.emails where thread_id = :'t';
delete from public.email_threads where id = :'t';
delete from public.email_senders where sender_key = 'gone242@ourshop.example';

\echo '>>> 0243: an order email from before the request cannot fill it'
insert into public.email_threads (organization_id, gmail_thread_id) values ('00000000-0000-0000-0000-000000000001', 'sup243') returning id as t3 \gset
insert into public.emails (organization_id, gmail_id, thread_id, direction, from_email, from_name, subject, body_text, received_at) values
  ('00000000-0000-0000-0000-000000000001', 'sup243-1', :'t3', 'internal', 'annie242@ourshop.example', 'Annie', 'New order', 'Need note pads', now() - interval '2 days') returning id as e3 \gset
insert into public.emails (organization_id, gmail_id, thread_id, direction, from_email, subject, body_text, received_at)
values ('00000000-0000-0000-0000-000000000001', 'sup243-2', :'t3', 'in', 'auto@shop243.example', 'Arrived: your order', 'Nail gel', now() - interval '10 days') returning id as d3 \gset
select public.supply_from_email(:'e3', true, 'Note pads', null, 'Annie', null, false) as req3 \gset
select public.supply_from_confirmation(:'d3', 'delivered', array[:'req3']::uuid[], 'Shop', '1', null, null, null) = 0 as older_email_ignored;
select status = 'requested' as still_requested from public.supply_requests where id = :'req3';
delete from public.tasks where auto_key = 'supply:' || :'req3';
delete from public.supply_requests where id = :'req3';
delete from public.emails where thread_id = :'t3';
delete from public.email_threads where id = :'t3';
