\set ON_ERROR_STOP on
\pset footer off
\echo '>>> 0279: personal insurance category; the bank''s proof through Myinsuranceinfo; repeating autopay reminders'
reset role;
select set_config('request.jwt.claims', '', false) is not null as service;
select id as admin_id from public.profiles where organization_id = '00000000-0000-0000-0000-000000000001' and role = 'admin' and is_active order by created_at limit 1 \gset
update public.profiles set sees_accounting = true where id = :'admin_id';
insert into public.mailboxes (organization_id, kind, address, label, owner_id, gmail_box, auto_share_vendor_mail)
values ('00000000-0000-0000-0000-000000000001', 'accounting', 'billing-0279@example.com', 'Billing', :'admin_id', 'billing-0279@example.com', false) returning id as mb \gset

\echo '>>> personal insurance is a category for contacts and papers, and a tick on policies'
insert into public.accounting_contacts (organization_id, company, category) values ('00000000-0000-0000-0000-000000000001', 'Goosehead 0279', 'personal_insurance') returning id as gh \gset
insert into public.accounting_policies (organization_id, label, coverage_type, personal) values ('00000000-0000-0000-0000-000000000001', 'Home 0279', 'fire_only', true) returning id as pol \gset
select category = 'personal_insurance' as contact_ok, (select personal from public.accounting_policies where id = :'pol') as policy_personal from public.accounting_contacts where id = :'gh';

\echo '>>> the bank (fixed date) gets a yearly task; a Myinsuranceinfo confirmation records the send and closes it'
insert into public.accounting_policy_recipients (organization_id, company, when_kind, due_month, due_day, status, send_how, why)
values ('00000000-0000-0000-0000-000000000001', 'Test Bank 0279', 'date', extract(month from current_date + 10)::int, extract(day from current_date + 10)::int, 'confirmed',
        'Upload it at myinsuranceinfo.com.', 'Commercial loan') returning id as rc \gset
select public.accounting_sync_policy_tasks('00000000-0000-0000-0000-000000000001') >= 1 as task_made;
select count(*) = 1 as one_task, bool_and(notes like '%myinsuranceinfo.com%') as says_upload from public.tasks where recipient_id = :'rc' and auto_key like 'proof_due:%' and done_at is null;
insert into public.email_threads (organization_id, gmail_thread_id, mailbox_id) values ('00000000-0000-0000-0000-000000000001', 'mii-0279', :'mb') returning id as th \gset
insert into public.emails (organization_id, thread_id, mailbox_id, gmail_id, direction, from_email, subject, body_text, received_at)
values ('00000000-0000-0000-0000-000000000001', :'th', :'mb', 'mii-0279-1', 'in', 'myinsuranceinfo-confirmation.do-not-reply@myinsuranceinfo.com', 'MyInsuranceInfo Confirmation',
        'This is confirmation that we received your insurance policy attachment named "COI 26-27 CGLI - Test Bank.pdf" and we will update our records', now());
select (select count(*) from public.accounting_policy_sends where recipient_id = :'rc') = 1 as send_recorded,
       (select term_label from public.accounting_policy_sends where recipient_id = :'rc') as term,
       (select last_sent_on = current_date from public.accounting_policy_recipients where id = :'rc') as last_sent_today,
       (select bool_and(done_at is not null and closed_how = 'vms' and done_note like 'Myinsuranceinfo confirmed%') from public.tasks where recipient_id = :'rc') as task_closed;
select public.accounting_sync_policy_tasks('00000000-0000-0000-0000-000000000001') is not null as rerun;
select count(*) = 0 as no_new_task_after_send from public.tasks where recipient_id = :'rc' and done_at is null;

\echo '>>> a repeating autopay makes its reminder 5 days ahead; an email for it updates that reminder; skipped payees make none'
insert into public.autopay_schedules (organization_id, payee, what, payee_match, every_months, next_on, amount)
values ('00000000-0000-0000-0000-000000000001', 'Drive 0279', 'auto', 'drive 0279', 6, current_date + 4, 3000) returning id as sch \gset
select public.autopay_schedule_tasks('00000000-0000-0000-0000-000000000001') = 1 as sched_task;
select title like 'Autopay % (expected): Drive 0279 ~$3,000.00%' as title_ok from public.tasks where auto_key = 'autopay_sched:' || :'sch' || ':' || (current_date + 4);
insert into public.emails (organization_id, thread_id, mailbox_id, gmail_id, direction, from_email, subject, received_at)
values ('00000000-0000-0000-0000-000000000001', :'th', :'mb', 'mii-0279-2', 'in', 'customerservice@drive0279.example', 'Scheduled payment reminder', now()) returning id as e2 \gset
select public.autopay_apply(:'e2', jsonb_build_array(jsonb_build_object('payee', 'Drive 0279', 'date', (current_date + 5)::text, 'amount', 3100.5, 'automatic', true))) = 0 as no_second_task;
select count(*) = 1 as still_one, bool_and(title like 'Autopay %: Drive 0279 $3,100.50%' and due_date = current_date + 5) as updated
  from public.tasks where organization_id = '00000000-0000-0000-0000-000000000001' and title like '%Drive 0279%';
select amount = 3100.50 as schedule_amount from public.autopay_schedules where id = :'sch';
select public.autopay_apply(:'e2', jsonb_build_array(jsonb_build_object('payee', 'Starlink', 'date', (current_date + 6)::text, 'amount', 130, 'automatic', true))) = 0 as starlink_skipped,
       not exists (select 1 from public.autopay_payments where payee = 'Starlink' and email_id = :'e2') as starlink_not_kept;
\echo '>>> past dates roll forward'
update public.autopay_schedules set next_on = current_date - 30 where id = :'sch';
select public.autopay_schedule_tasks('00000000-0000-0000-0000-000000000001') is not null as rolled;
select next_on = (current_date - 30 + interval '6 months')::date as next_in_six_months from public.autopay_schedules where id = :'sch';

delete from public.tasks where organization_id = '00000000-0000-0000-0000-000000000001' and (recipient_id = :'rc' or title like '%Drive 0279%');
delete from public.autopay_payments where email_id = :'e2';
delete from public.autopay_schedules where id = :'sch';
delete from public.accounting_policy_sends where recipient_id = :'rc';
delete from public.accounting_policy_recipients where id = :'rc';
delete from public.emails where gmail_id like 'mii-0279-%';
delete from public.email_threads where id = :'th';
delete from public.accounting_policies where id = :'pol';
delete from public.accounting_contacts where id = :'gh';
delete from public.mailboxes where id = :'mb';
