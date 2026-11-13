\set ON_ERROR_STOP on
\pset footer off
\echo '>>> 0368: an IRS or FTB payment with no Direct Pay / Web Pay confirmation by its due date makes a task at once'
reset role;
select set_config('request.jwt.claims', '', false) is not null as service;
select id as admin_id from public.profiles where organization_id = '00000000-0000-0000-0000-000000000001' and role = 'admin' and is_active order by created_at limit 1 \gset
update public.profiles set sees_accounting = true where id = :'admin_id';
insert into public.mailboxes (organization_id, kind, address, label, owner_id, gmail_box, auto_share_vendor_mail)
values ('00000000-0000-0000-0000-000000000001', 'accounting', 'billing-0368@example.com', 'Billing', :'admin_id', 'billing-0368@example.com', false);
do $$
declare v_org uuid := '00000000-0000-0000-0000-000000000001'; mb uuid; th uuid; e1 uuid; t record; p1 uuid; p2 uuid; r jsonb; today date := (now() at time zone 'America/Los_Angeles')::date;
begin
  select id into mb from public.mailboxes where gmail_box = 'billing-0368@example.com';
  if not public.autopay_is_tax('IRS') or not public.autopay_is_tax('FTB') or public.autopay_is_tax('Drive Insurance') then raise exception 'tax payees not told apart'; end if;
  insert into public.email_threads (organization_id, gmail_thread_id, subject, last_message_at, mailbox_id) values (v_org, 't0368', 'MBS estimates', now(), mb) returning id into th;
  insert into public.emails (organization_id, thread_id, gmail_id, direction, from_email, to_emails, subject, received_at, body_text, mailbox_id)
  values (v_org, th, 'm0368-0', 'in', 'nawal@mbs0368.example', '{billing-0368@example.com}', 'Estimated payments', now() - interval '40 days', 'x', mb) returning id into e1;
  -- two estimates due today: the IRS one was scheduled (Direct Pay confirmation 20 days ago), the FTB one was not
  insert into public.autopay_payments (organization_id, email_id, payee, what, pay_on, amount, automatic, dedupe_key) values (v_org, e1, 'IRS', '2026 federal estimated tax', today, 87000, true, 'irs0368') returning id into p1;
  insert into public.autopay_payments (organization_id, email_id, payee, what, pay_on, amount, automatic, dedupe_key) values (v_org, e1, 'FTB', '2026 CA estimated tax', today, 7000, true, 'ftb0368') returning id into p2;
  insert into public.emails (organization_id, thread_id, gmail_id, direction, from_email, to_emails, subject, received_at, body_text, mailbox_id)
  values (v_org, th, 'm0368-1', 'in', 'mail@directpay.irs.gov', '{billing-0368@example.com}', 'IRS Direct Pay Confirmation of Scheduled Transaction', now() - interval '20 days', 'NO TEXT', mb);
  r := public.autopay_sweep(v_org);
  if (select confirmed_email_id from public.autopay_payments where id = p1) is null then raise exception 'the Direct Pay confirmation did not cover the IRS payment'; end if;
  if exists (select 1 from public.tasks where auto_key = 'autopay_check:' || p1) then raise exception 'a check task for a confirmed IRS payment'; end if;
  select * into t from public.tasks where auto_key = 'autopay_check:' || p2;
  if t.id is null then raise exception 'no task for the unconfirmed FTB payment due today'; end if;
  if t.title not like 'FTB $7,000.00 (2026 CA estimated tax) is due %: no payment confirmation on file, make it today if it was not made' then raise exception 'title: %', t.title; end if;
  if t.due_date <> today or t.remind_at > now() then raise exception 'not due today and reminded now'; end if;
  -- the Web Pay confirmation arrives: the task closes itself, dated by the email
  insert into public.emails (organization_id, thread_id, gmail_id, direction, from_email, to_emails, subject, received_at, body_text, mailbox_id)
  values (v_org, th, 'm0368-2', 'in', 'no_reply.webpay@ftb.ca.gov', '{billing-0368@example.com}', 'Web Pay Payment Scheduled', now() - interval '1 hour', 'Thank you for scheduling your payment.', mb);
  select * into t from public.tasks where auto_key = 'autopay_check:' || p2;
  if t.done_at is null or t.closed_how <> 'vms' then raise exception 'the Web Pay confirmation did not close the task'; end if;
  raise exception 'ok-rollback';
exception when others then
  if sqlerrm <> 'ok-rollback' then raise; end if;
end $$;
