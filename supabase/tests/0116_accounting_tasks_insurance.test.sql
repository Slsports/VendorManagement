\set ON_ERROR_STOP on
\pset footer off
\echo '>>> Accounting tasks, procedures, insurance: renewal tasks 30 days ahead, proof recipients from the mail, sends logged, all behind the tick'
reset role;
select set_config('request.jwt.claims', '', false) is not null as claims_cleared;
select id as admin_id from public.profiles where organization_id = '00000000-0000-0000-0000-000000000001' and role = 'admin' and is_active order by created_at limit 1 \gset
update public.profiles set sees_accounting = true where id = :'admin_id';
insert into auth.users (id, email) values ('99999999-2222-3333-4444-555555555555', 'acct-mgr2@example.com') on conflict do nothing;
insert into public.profiles (id, organization_id, email, full_name, role, is_active) values ('99999999-2222-3333-4444-555555555555', '00000000-0000-0000-0000-000000000001', 'acct-mgr2@example.com', 'Manager Two', 'manager', true) on conflict (id) do update set role = 'manager', organization_id = excluded.organization_id, is_active = true, sees_accounting = false;
insert into public.accounting_procedures (organization_id, slug, title, category, body) values ('00000000-0000-0000-0000-000000000001', 'property-insurance-renewal', 'Property insurance renewal', 'insurance', '1. Get the renewal from Sam.');
insert into public.accounting_procedures (organization_id, slug, title, category, body) values ('00000000-0000-0000-0000-000000000001', 'send-proof-of-insurance', 'Send proof of insurance', 'insurance', '1. Attach the policy.');
insert into public.accounting_policies (organization_id, label, carrier, policy_number, paid_by, renewal_date, autopay) values ('00000000-0000-0000-0000-000000000001', 'Red House fire', 'Cal Fair Plan', 'CFP 1', 'P & S', current_date + 20, false) returning id as pol \gset
insert into public.accounting_policies (organization_id, label, carrier, policy_number, paid_by, renewal_date) values ('00000000-0000-0000-0000-000000000001', 'Far away policy', 'Hudson', 'SL 2', 'SLS', current_date + 200) returning id as far \gset
select public.accounting_owner('00000000-0000-0000-0000-000000000001') = :'admin_id' as owner_is_admin;
select public.accounting_sync_policy_tasks('00000000-0000-0000-0000-000000000001') as renewal_tasks_made;
select title, area, due_date = current_date + 20 as due_on_renewal, (remind_at at time zone 'America/Los_Angeles')::date = current_date - 10 as reminded_30_days_before,
       procedure_id is not null as has_procedure, policy_id = :'pol' as on_policy, assigned_to = :'admin_id' as to_dana
  from public.tasks where auto_key like 'policy_renewal:%' order by title;
select public.accounting_sync_policy_tasks('00000000-0000-0000-0000-000000000001') as second_run_makes_none;

-- the mail: the bank asks for proof; a newsletter mentions insurance; the agent writes
insert into public.mailboxes (organization_id, kind, address, label, owner_id, gmail_box, auto_share_vendor_mail) values ('00000000-0000-0000-0000-000000000001', 'accounting', 'billing-e@example.com', 'Billing', :'admin_id', 'billing-e@example.com', false) returning id as mb \gset
insert into public.email_threads (organization_id, gmail_thread_id, mailbox_id, subject) values ('00000000-0000-0000-0000-000000000001', 'ai-t1', :'mb', 'Certificate of Insurance needed') returning id as t1 \gset
insert into public.emails (organization_id, gmail_id, thread_id, direction, mailbox_id, gmail_box, from_email, from_name, to_emails, subject, body_text, received_at)
  values ('00000000-0000-0000-0000-000000000001', 'ai-e1', :'t1', 'in', :'mb', 'billing-e@example.com', 'loans@bank-test.com', 'Pat Lender', array['billing-e@example.com'], 'Certificate of Insurance needed', 'Please send the updated certificate of insurance for the loan file.', now() - interval '10 days');
insert into public.email_threads (organization_id, gmail_thread_id, mailbox_id, subject) values ('00000000-0000-0000-0000-000000000001', 'ai-t2', :'mb', 'Save on insurance!') returning id as t2 \gset
insert into public.emails (organization_id, gmail_id, thread_id, direction, mailbox_id, gmail_box, from_email, from_name, to_emails, subject, body_text, received_at, is_bulk)
  values ('00000000-0000-0000-0000-000000000001', 'ai-e2', :'t2', 'in', :'mb', 'billing-e@example.com', 'promo@insure-ads.example', 'Ads', array['billing-e@example.com'], 'Save on insurance!', 'Get a certificate of insurance quote today', now(), true);

set role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', :'admin_id', 'role', 'authenticated')::text, false) is not null as as_admin;
select public.accounting_propose_recipients('00000000-0000-0000-0000-000000000001') as recipients_proposed;
select email, person, status, asked_at is not null as asked from public.accounting_policy_recipients where organization_id = '00000000-0000-0000-0000-000000000001';
select id as rc from public.accounting_policy_recipients where email = 'loans@bank-test.com' \gset
update public.accounting_policy_recipients set status = 'confirmed', company = 'Bank Test', policy_ids = array[:'pol'::uuid] where id = :'rc';
-- the policy paper comes in: one send task per recipient needing it
select public.accounting_policy_received(:'pol', '2026-27') as send_tasks_made;
select title, due_date = current_date + 7 as due_in_a_week, recipient_id = :'rc' as to_recipient, procedure_id is not null as has_procedure from public.tasks where auto_key like 'policy_send:%';
select public.accounting_policy_received(:'pol', '2026-27') as again_makes_none;
-- we sent it: logged, stamped, task closed, "asked" cleared
select public.accounting_record_send(:'rc', :'pol', '2026-27', 'us');
select last_sent_term, last_sent_by, asked_at is null as asked_cleared from public.accounting_policy_recipients where id = :'rc';
select count(*) as send_task_still_open from public.tasks where auto_key like 'policy_send:%' and done_at is null;
select count(*) as sends_logged from public.accounting_policy_sends where recipient_id = :'rc';
-- the bank asks again later: flagged on arrival
reset role;
select set_config('request.jwt.claims', '', false) is not null as claims_cleared_2;
insert into public.email_threads (organization_id, gmail_thread_id, mailbox_id, subject) values ('00000000-0000-0000-0000-000000000001', 'ai-t3', :'mb', 'Proof of insurance') returning id as t3 \gset
insert into public.emails (organization_id, gmail_id, thread_id, direction, mailbox_id, gmail_box, from_email, from_name, to_emails, subject, body_text, received_at)
  values ('00000000-0000-0000-0000-000000000001', 'ai-e3', :'t3', 'in', :'mb', 'billing-e@example.com', 'loans@bank-test.com', 'Pat Lender', array['billing-e@example.com'], 'Proof of insurance', 'We need the new policy for our file.', now() + interval '1 day');
select asked_at is not null as asked_again from public.accounting_policy_recipients where id = :'rc';
-- renewed: term recorded, date moves a year, renewal task closed
set role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', :'admin_id', 'role', 'authenticated')::text, false) is not null as as_admin_2;
select public.accounting_policy_renewed(:'pol', '2027-28', 1800.00, current_date, 'P&S checking', null, 'CFP 2');
select renewal_date = current_date + 20 + interval '1 year' as moved_a_year, policy_number as new_number, prior_policy_numbers as old_numbers from public.accounting_policies where id = :'pol';
select count(*) as renewal_tasks_open from public.tasks where auto_key like 'policy_renewal:%' and done_at is null;
select premium, paid_from from public.accounting_policy_terms where policy_id = :'pol' and term_label = '2027-28';
-- a manager without the tick sees none of it, including the accounting tasks (even the admin's general tasks policy would show them)
select set_config('request.jwt.claims', '{"sub":"99999999-2222-3333-4444-555555555555","role":"authenticated"}', false) is not null as as_manager;
select (select count(*) from public.accounting_policies) as mgr_policies, (select count(*) from public.accounting_procedures) as mgr_procedures, (select count(*) from public.tasks where area = 'accounting') as mgr_accounting_tasks;
\set ON_ERROR_STOP off
\echo '--- a manager cannot add an accounting task (expect an error)'
insert into public.tasks (organization_id, title, assigned_to, area) values ('00000000-0000-0000-0000-000000000001', 'sneaky', '99999999-2222-3333-4444-555555555555', 'accounting');
\set ON_ERROR_STOP on
reset role;
select set_config('request.jwt.claims', '', false) is not null as claims_cleared_3;
delete from public.tasks where area = 'accounting';
delete from public.mailboxes where id = :'mb';
delete from public.accounting_policies where organization_id = '00000000-0000-0000-0000-000000000001';
delete from public.accounting_policy_recipients where organization_id = '00000000-0000-0000-0000-000000000001';
delete from public.accounting_procedures where organization_id = '00000000-0000-0000-0000-000000000001';
delete from public.profiles where id = '99999999-2222-3333-4444-555555555555';
delete from auth.users where id = '99999999-2222-3333-4444-555555555555';
