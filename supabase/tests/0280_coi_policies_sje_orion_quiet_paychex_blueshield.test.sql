\set ON_ERROR_STOP on
\pset footer off
\echo '>>> 0280: quiet accounting contacts: filed as Handled; a task only for a deadline still ahead'
reset role;
select set_config('request.jwt.claims', '', false) is not null as service;
select id as admin_id from public.profiles where organization_id = '00000000-0000-0000-0000-000000000001' and role = 'admin' and is_active order by created_at limit 1 \gset
update public.profiles set sees_accounting = true where id = :'admin_id';
insert into public.mailboxes (organization_id, kind, address, label, owner_id, gmail_box, auto_share_vendor_mail)
values ('00000000-0000-0000-0000-000000000001', 'accounting', 'billing-0280@example.com', 'Billing', :'admin_id', 'billing-0280@example.com', false) returning id as mb \gset
insert into public.accounting_contacts (organization_id, company, category, quiet) values ('00000000-0000-0000-0000-000000000001', 'Payroll 0280', 'payroll', true) returning id as qc \gset
insert into public.accounting_contacts (organization_id, company, category) values ('00000000-0000-0000-0000-000000000001', 'Loud 0280', 'other') returning id as lc \gset
insert into public.accounting_contact_addresses (organization_id, address, is_domain, contact_id) values ('00000000-0000-0000-0000-000000000001', 'payroll0280.example', true, :'qc');

insert into public.email_threads (organization_id, gmail_thread_id, mailbox_id, status, accounting_contact_id) values
  ('00000000-0000-0000-0000-000000000001', 'q0280-1', :'mb', 'waiting_on_us', :'qc') returning id as tq \gset
insert into public.email_threads (organization_id, gmail_thread_id, mailbox_id, status, accounting_contact_id) values
  ('00000000-0000-0000-0000-000000000001', 'q0280-2', :'mb', 'waiting_on_us', :'lc') returning id as tl \gset
select (select status from public.email_threads where id = :'tq') = 'handled' as quiet_handled,
       (select status from public.email_threads where id = :'tl') = 'waiting_on_us' as other_waits;
\echo '>>> a thread filed to the quiet contact later, or set waiting again, goes to Handled too'
update public.email_threads set accounting_contact_id = :'qc' where id = :'tl';
update public.email_threads set status = 'waiting_on_us' where id = :'tq';
select (select status from public.email_threads where id = :'tl') = 'handled' as refiled_handled,
       (select status from public.email_threads where id = :'tq') = 'handled' as stays_handled;
\echo '>>> waiting on them is left alone'
update public.email_threads set status = 'waiting_on_vendor' where id = :'tq';
select status = 'waiting_on_vendor' as waiting_on_them_kept from public.email_threads where id = :'tq';

insert into public.emails (organization_id, thread_id, mailbox_id, gmail_id, direction, from_email, subject, body_text, received_at) values
  ('00000000-0000-0000-0000-000000000001', :'tq', :'mb', 'q0280-a', 'in', 'notice@payroll0280.example', 'Action needed', 'Please sign by the 20th', now()),
  ('00000000-0000-0000-0000-000000000001', :'tq', :'mb', 'q0280-b', 'in', 'news@payroll0280.example', 'Newsletter', 'News', now() - interval '1 hour'),
  ('00000000-0000-0000-0000-000000000001', :'tq', :'mb', 'q0280-c', 'in', 'old@payroll0280.example', 'Old', 'Old', now() - interval '120 days');
select count(*) = 2 as queue_last_90_days from public.quiet_deadline_queue('00000000-0000-0000-0000-000000000001', 50) q where q.email_id in (select id from public.emails where gmail_id like 'q0280-%');
select id as ea from public.emails where gmail_id = 'q0280-a' \gset
select id as eb from public.emails where gmail_id = 'q0280-b' \gset
select public.quiet_deadline_apply(:'ea', 'Sign the form', current_date + 18) is not null as deadline_task;
select title like 'Payroll 0280: Sign the form by %' as title_ok, area = 'accounting' as accounting, remind_rule = 'ask' as weekly_reminders, remind_at <= now() as reminds_now
  from public.tasks where auto_key = 'deadline:' || :'ea';
select public.quiet_deadline_apply(:'eb', null, null) is null as no_task_for_news;
select deadline_read_at is not null as marked_read from public.emails where id = :'eb';
select public.quiet_deadline_apply(:'ea', 'Sign the form', current_date + 18) is null as once_only;
select count(*) = 0 as past_deadline_no_task from (select public.quiet_deadline_apply(:'eb', 'Something', current_date - 1) x) s where x is not null;

delete from public.tasks where auto_key like 'deadline:%' and thread_id in (:'tq', :'tl');
delete from public.emails where gmail_id like 'q0280-%';
delete from public.email_threads where id in (:'tq', :'tl');
delete from public.accounting_contact_addresses where contact_id = :'qc';
delete from public.accounting_contacts where id in (:'qc', :'lc');
delete from public.mailboxes where id = :'mb';
