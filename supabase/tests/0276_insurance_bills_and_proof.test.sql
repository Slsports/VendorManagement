\set ON_ERROR_STOP on
\pset footer off
\echo '>>> 0276: an insurer''s bill makes a task, its payment confirmation pays the policy year and closes it; a new policy paper sends proof'
reset role;
select set_config('request.jwt.claims', '', false) is not null as service;
select public.org_admin('00000000-0000-0000-0000-000000000001') as admin_id \gset
update public.profiles set sees_accounting = true where id = :'admin_id';
insert into public.accounting_policies (organization_id, label, carrier, policy_number, paid_by, renewal_date) values
  ('00000000-0000-0000-0000-000000000001', 'TR276 Insurance', 'Travelers', 'TR276G0232', 'SLS', (date_trunc('year', current_date) + interval '6 months 2 days')::date) returning id as pol \gset
insert into public.mailboxes (organization_id, kind, address, label, owner_id, gmail_box) values
  ('00000000-0000-0000-0000-000000000001', 'accounting', 'billing276@example.com', 'Billing 276', :'admin_id', 'billing276@example.com') returning id as mb \gset
insert into public.email_threads (organization_id, gmail_thread_id, subject, last_message_at, mailbox_id) values ('00000000-0000-0000-0000-000000000001', 'tr276', 'Travelers', now(), :'mb') returning id as t \gset
-- bill ready
insert into public.emails (organization_id, thread_id, gmail_id, direction, from_email, subject, body_text, received_at, mailbox_id) values
  ('00000000-0000-0000-0000-000000000001', :'t', 'tr276-1', 'in', 'bill@travelers.example', 'Your Travelers Bill is Ready.',
   'Your bill is available. BILLING ACCOUNT TR276G0232 MINIMUM DUE $2,137.50 REMAINING BALANCE $8,526.00 BILL DUE DATE ' || to_char(current_date + 20, 'MM/DD/YYYY'), now() - interval '2 days', :'mb');
select title like 'Pay TR276 Insurance: $2,137.50 due %' and notes like '%Balance $8,526.00%' and remind_at > now() + interval '10 days' as bill_task
  from public.tasks where auto_key like 'policy_bill:' || :'pol' || ':%';
-- past due: same task, reminded now
insert into public.emails (organization_id, thread_id, gmail_id, direction, from_email, subject, body_text, received_at, mailbox_id) values
  ('00000000-0000-0000-0000-000000000001', :'t', 'tr276-2', 'in', 'bill@travelers.example', 'Action Needed: Submit Your Past Due Payment',
   'A payment of $2,137.50 was due by ' || to_char(current_date + 20, 'MM/DD/YYYY') || '. BILLING ACCOUNT TR276G0232 MINIMUM DUE $2,137.50', now() - interval '1 day', :'mb');
select count(*) = 1 and bool_and(title like 'PAST DUE:%' and remind_at <= now() + interval '1 minute') as past_due_same_task
  from public.tasks where auto_key like 'policy_bill:' || :'pol' || ':%';
-- payment confirmation
insert into public.emails (organization_id, thread_id, gmail_id, direction, from_email, subject, body_text, received_at, mailbox_id) values
  ('00000000-0000-0000-0000-000000000001', :'t', 'tr276-3', 'in', 'bill@travelers.example', 'Travelers Payment Confirmation',
   'Your payment of $8,526.00 is scheduled for ' || to_char(current_date, 'MM/DD/YYYY') || '. BILLING ACCOUNT TR276G0232 CONFIRMATION 850551413381391 PAYMENT AMOUNT $8,526.00', now(), :'mb')
  returning id as pay \gset
select done_at is not null and done_note like 'VMS saw Travelers''s payment confirmation: Paid $8,526.00%' as task_closed
  from public.tasks where auto_key like 'policy_bill:' || :'pol' || ':%';
select paid_amount = 8526.00 and paid_on = current_date and paid_email_id = :'pay' as year_paid from public.accounting_policy_terms where policy_id = :'pol';
-- a new policy paper sends proof to whoever needs it
insert into public.accounting_policy_recipients (organization_id, company, person, email, policy_ids, when_kind, status, why)
values ('00000000-0000-0000-0000-000000000001', 'SCE276', 'Andrew', 'andrew276@sce.example', array[:'pol']::uuid[], 'renewal', 'confirmed', 'License') returning id as rc \gset
insert into public.accounting_documents (organization_id, category, party, doc_year, file_name, kind, doc_date, storage_path, sha256, policy_id)
values ('00000000-0000-0000-0000-000000000001', 'insurance', 'Travelers', extract(year from current_date)::int, 'tr276 policy.pdf', 'policy', current_date, 'x/tr276.pdf', 'tr276', :'pol');
select count(*) = 1 as send_task from public.tasks where auto_key like 'policy_send:' || :'rc' || ':%';
-- an old paper filed later sends nothing
insert into public.accounting_documents (organization_id, category, party, doc_year, file_name, kind, doc_date, storage_path, sha256, policy_id)
values ('00000000-0000-0000-0000-000000000001', 'insurance', 'Travelers', 2022, 'tr276 old.pdf', 'policy', date '2022-05-26', 'x/tr276o.pdf', 'tr276o', :'pol');
select count(*) = 1 as old_paper_no_task from public.tasks where auto_key like 'policy_send:' || :'rc' || ':%';
delete from public.tasks where policy_id = :'pol';
delete from public.accounting_documents where policy_id = :'pol';
delete from public.accounting_policy_recipients where id = :'rc';
delete from public.emails where thread_id = :'t';
delete from public.email_threads where id = :'t';
delete from public.mailboxes where id = :'mb';
delete from public.accounting_policies where id = :'pol';
