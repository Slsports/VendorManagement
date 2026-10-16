\set ON_ERROR_STOP on
\pset footer off
\echo '>>> Accounting mail queues: old billing@ mail is left out of the sort and reply-check lists; recent mail stays in'
reset role;
select set_config('request.jwt.claims', '', false) is not null as claims_cleared;
select id as admin_id from public.profiles where organization_id = '00000000-0000-0000-0000-000000000001' and role = 'admin' and is_active order by created_at limit 1 \gset
insert into public.mailboxes (organization_id, kind, address, label, owner_id, gmail_box, auto_share_vendor_mail) values ('00000000-0000-0000-0000-000000000001', 'accounting', 'billing-q@example.com', 'Billing', :'admin_id', 'billing-q@example.com', false) returning id as mb \gset
insert into public.email_threads (organization_id, gmail_thread_id, mailbox_id, status) values ('00000000-0000-0000-0000-000000000001', 'q-old', :'mb', 'waiting_on_us') returning id as told \gset
insert into public.email_threads (organization_id, gmail_thread_id, mailbox_id, status) values ('00000000-0000-0000-0000-000000000001', 'q-new', :'mb', 'waiting_on_us') returning id as tnew \gset
insert into public.emails (organization_id, gmail_id, thread_id, direction, from_email, subject, received_at, mailbox_id, is_bulk)
  values ('00000000-0000-0000-0000-000000000001', 'q-old-1', :'told', 'in', 'old@example.com', 'Old statement', now() - interval '400 days', :'mb', false),
         ('00000000-0000-0000-0000-000000000001', 'q-new-1', :'tnew', 'in', 'new@example.com', 'New statement', now() - interval '2 days', :'mb', false);
-- mail arriving resets the thread's status; put both back to waiting on us
update public.email_threads set status = 'waiting_on_us' where id in (:'told', :'tnew');
select subject from public.mail_reply_queue('00000000-0000-0000-0000-000000000001', 50) where subject in ('Old statement', 'New statement') order by 1;
select subject from public.mail_unsure_emails('00000000-0000-0000-0000-000000000001', 500) where subject in ('Old statement', 'New statement') order by 1;
delete from public.email_threads where id in (:'told', :'tnew');
delete from public.mailboxes where id = :'mb';
