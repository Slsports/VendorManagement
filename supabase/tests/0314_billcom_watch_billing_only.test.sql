\set ON_ERROR_STOP on
\pset footer off
\echo '>>> 0314: the Bill.com watch counts billing@ mail only'
reset role;
select set_config('request.jwt.claims', '', false) is not null as service;
insert into public.vendors (organization_id, name, billcom_auto_on_from) values ('00000000-0000-0000-0000-000000000001', 'BW313 DIST', 'old@forward.example') returning id as v \gset
insert into public.email_threads (organization_id, gmail_thread_id) values ('00000000-0000-0000-0000-000000000001', 'bw313') returning id as th \gset

\echo '>>> an order confirmation straight to orders@ changes nothing'
insert into public.emails (organization_id, thread_id, gmail_id, direction, from_email, to_emails, subject, received_at, vendor_id, delivered_to)
values ('00000000-0000-0000-0000-000000000001', :'th', 'bw313-1', 'in', 'noreply@dist.example', '{}', 'Order confirmation', now(), :'v', array['orders@shaverlakesports.com']);
select not billcom_send and billcom_auto_on_from = 'old@forward.example' as still_watching from public.vendors where id = :'v';

\echo '>>> an email straight to the billing@ mailbox turns it on'
insert into public.mailboxes (organization_id, kind, address, label, gmail_box, owner_id) select '00000000-0000-0000-0000-000000000001', 'accounting', 'billing-bw313@shaverlakesports.com', 'Billing', 'billing-bw313@shaverlakesports.com', id from public.profiles where role = 'admin' and organization_id = '00000000-0000-0000-0000-000000000001' limit 1
returning id as box \gset
insert into public.emails (organization_id, thread_id, gmail_id, direction, from_email, to_emails, subject, received_at, vendor_id, delivered_to, mailbox_id, gmail_box)
values ('00000000-0000-0000-0000-000000000001', :'th', 'bw313-2', 'in', 'noreply@dist.example', '{}', 'Invoice', now(), :'v', array['billing-bw313@shaverlakesports.com'], :'box', 'billing-bw313@shaverlakesports.com');
select billcom_send and billcom_auto_on_from is null as turned_on from public.vendors where id = :'v';

delete from public.tasks where auto_key = 'billcom_auto:' || :'v';
delete from public.emails where gmail_id like 'bw313-%';
delete from public.email_threads where id = :'th';
delete from public.mailboxes where id = :'box';
delete from public.vendors where id = :'v';
