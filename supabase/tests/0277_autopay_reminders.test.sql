\set ON_ERROR_STOP on
\pset footer off
\echo '>>> 0277: scheduled payments from the billing mail become one task each, 5 days ahead'
reset role;
select set_config('request.jwt.claims', '', false) is not null as service;
select public.org_admin('00000000-0000-0000-0000-000000000001') as admin_id \gset
update public.profiles set sees_accounting = true where id = :'admin_id';
insert into public.mailboxes (organization_id, kind, address, label, owner_id, gmail_box) values
  ('00000000-0000-0000-0000-000000000001', 'accounting', 'billing277@example.com', 'Billing 277', :'admin_id', 'billing277@example.com') returning id as mb \gset
insert into public.email_threads (organization_id, gmail_thread_id, subject, last_message_at, mailbox_id) values ('00000000-0000-0000-0000-000000000001', 'ap277', 'Estimated taxes', now(), :'mb') returning id as t \gset
insert into public.emails (organization_id, thread_id, gmail_id, gmail_box, direction, from_email, subject, body_text, received_at, mailbox_id) values
  ('00000000-0000-0000-0000-000000000001', :'t', 'ap277-1', 'billing277@example.com', 'in', 'maggie@mbsaccountancy.com', 'Re: Estimated Taxes', 'set up to automatically withdraw', now(), :'mb'),
  ('00000000-0000-0000-0000-000000000001', :'t', 'ap277-2', 'billing277@example.com', 'in', 'no_reply.webpay@ftb.ca.gov', 'Web Pay Payment Scheduled', 'Thank you for scheduling', now(), :'mb'),
  ('00000000-0000-0000-0000-000000000001', :'t', 'ap277-3', 'billing277@example.com', 'in', 'no_reply@ftb.ca.gov', 'Franchise Tax Board Password Expiration Notice', 'password', now(), :'mb');
select array_agg(subject order by subject) = array['Re: Estimated Taxes', 'Web Pay Payment Scheduled'] as queue_skips_password
  from public.autopay_queue('00000000-0000-0000-0000-000000000001', 50) q where q.email_id in (select id from public.emails where thread_id = :'t');
select public.autopay_apply((select id from public.emails where gmail_id = 'ap277-1'),
  jsonb_build_array(
    jsonb_build_object('payee', 'FTB', 'what', '2026 CA estimated tax', 'date', (current_date + 30)::text, 'amount', 2000, 'automatic', true),
    jsonb_build_object('payee', 'IRS', 'what', '2026 federal estimated tax', 'date', (current_date + 2)::text, 'amount', 74000, 'automatic', false),
    jsonb_build_object('payee', 'IRS', 'what', 'paid already', 'date', (current_date - 40)::text, 'amount', 10, 'automatic', true),
    jsonb_build_object('payee', 'CDTFA', 'what', 'sales tax', 'date', (current_date + 10)::text, 'amount', 100, 'automatic', false))) = 2 as two_tasks;
select title = 'Autopay ' || to_char(current_date + 30, 'Mon FMDD') || ': FTB $2,000.00 (2026 CA estimated tax)' and remind_at::date = current_date + 25 - case when now() at time zone 'America/Los_Angeles' > (current_date + 25)::timestamp + time '09:00' then 0 else 0 end and area = 'accounting' as autopay_task
  from public.tasks t join public.autopay_payments p on p.task_id = t.id where p.payee = 'FTB' and p.pay_on = current_date + 30;
select title like 'Pay by %: IRS $74,000.00%' and remind_at <= now() + interval '1 minute' as soon_reminds_now
  from public.tasks t join public.autopay_payments p on p.task_id = t.id where p.payee = 'IRS' and p.pay_on = current_date + 2;
-- the FTB confirmation of the same payment: no second task
select public.autopay_apply((select id from public.emails where gmail_id = 'ap277-2'),
  jsonb_build_array(jsonb_build_object('payee', 'FTB', 'what', 'estimated payment', 'date', (current_date + 30)::text, 'amount', 2000, 'automatic', true))) = 0 as same_payment_once;
delete from public.tasks where id in (select task_id from public.autopay_payments where email_id in (select id from public.emails where thread_id = :'t'));
delete from public.autopay_payments where email_id in (select id from public.emails where thread_id = :'t');
delete from public.emails where thread_id = :'t';
delete from public.email_threads where id = :'t';
delete from public.mailboxes where id = :'mb';
