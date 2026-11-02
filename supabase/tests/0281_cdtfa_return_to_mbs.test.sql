\set ON_ERROR_STOP on
\pset footer off
\echo '>>> 0281: the CDTFA quarter return closing makes a next-day task and a draft to Nawal; sending it closes the task'
reset role;
select set_config('request.jwt.claims', '', false) is not null as service;
select id as admin_id from public.profiles where organization_id = '00000000-0000-0000-0000-000000000001' and role = 'admin' and is_active order by created_at limit 1 \gset
update public.profiles set sees_accounting = true where id = :'admin_id';
insert into public.mailboxes (organization_id, kind, address, label, owner_id, gmail_box, auto_share_vendor_mail)
values ('00000000-0000-0000-0000-000000000001', 'accounting', 'billing-0281@example.com', 'Billing', :'admin_id', 'billing-0281@example.com', false) returning id as mb \gset
insert into public.tasks (organization_id, title, due_date, assigned_to, auto_key, area)
values ('00000000-0000-0000-0000-000000000001', 'CDTFA Q3 2096 sales tax return and payment', current_date, :'admin_id', 'cdtfa:2096-10', 'accounting') returning id as qt \gset
\echo '>>> only the filing seen: closing it by hand makes nothing'
update public.tasks set cdtfa_seen = jsonb_build_object('filing', gen_random_uuid(), 'filing_no', '1', 'period_end', '2096-09-30') where id = :'qt';
select count(*) = 0 as nothing_yet from public.tasks where auto_key = 'cdtfa_mbs:2096-Q3';
\echo '>>> both confirmations and the task closes: tomorrow''s task and the draft'
update public.tasks set cdtfa_seen = cdtfa_seen || jsonb_build_object('payment', gen_random_uuid(), 'payment_no', '2', 'payment_on', current_date), done_at = now() where id = :'qt';
select title = 'Send the Q3 2096 sales tax return to Nawal (MBS)' as title_ok, due_date = current_date + 1 as tomorrow, area = 'accounting' as accounting,
       draft_id is not null as has_draft
  from public.tasks where auto_key = 'cdtfa_mbs:2096-Q3';
select d.subject = 'Q3 2096 Sales Tax Return' as subject_ok, d.to_emails = array['nawal@mbsaccountancy.com'] as to_nawal, d.mailbox_id = :'mb' as from_billing,
       d.body like 'Hi Nawal,%3rd quarter 2096 sales tax return.%' as body_ok
  from public.email_drafts d join public.tasks t on t.draft_id = d.id where t.auto_key = 'cdtfa_mbs:2096-Q3';
\echo '>>> once only'
update public.tasks set done_at = null where id = :'qt';
update public.tasks set done_at = now() where id = :'qt';
select count(*) = 1 as once_only from public.tasks where auto_key = 'cdtfa_mbs:2096-Q3';
\echo '>>> the email to Nawal closes it'
insert into public.email_threads (organization_id, gmail_thread_id, mailbox_id) values ('00000000-0000-0000-0000-000000000001', 'cdtfa-0281', :'mb') returning id as th \gset
insert into public.emails (organization_id, thread_id, mailbox_id, gmail_id, direction, from_email, to_emails, subject, received_at)
values ('00000000-0000-0000-0000-000000000001', :'th', :'mb', 'cdtfa-0281-1', 'out', 'billing-0281@example.com', array['Nawal@mbsaccountancy.com'], 'Q3 2096 Sales Tax Return', now() + interval '2 minutes');
select done_at is not null as closed, closed_how = 'vms' as by_vms, done_note like 'The return went to Nawal on %' as note_ok from public.tasks where auto_key = 'cdtfa_mbs:2096-Q3';

delete from public.emails where gmail_id = 'cdtfa-0281-1';
delete from public.email_threads where id = :'th';
delete from public.tasks where auto_key in ('cdtfa_mbs:2096-Q3', 'cdtfa:2096-10');
delete from public.email_drafts where mailbox_id = :'mb';
delete from public.mailboxes where id = :'mb';
