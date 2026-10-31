\set ON_ERROR_STOP on
\pset footer off
\echo '>>> 0269: our own stated freight price approves the vendor quote; quotes in the admin''s own inbox stay private'
reset role;
select set_config('request.jwt.claims', '', false) is not null as service;
select mailbox as box from public.mail_accounts where organization_id = '00000000-0000-0000-0000-000000000001' \gset
insert into public.vendors (organization_id, name) values ('00000000-0000-0000-0000-000000000001', 'FQ269 GLOVES') returning id as v \gset
insert into public.orders (organization_id, vendor_id, po_number, status) values ('00000000-0000-0000-0000-000000000001', :'v', 'FQ2926', 'confirmed') returning id as o \gset
insert into public.email_threads (organization_id, gmail_thread_id, subject, last_message_at) values ('00000000-0000-0000-0000-000000000001', 'fq269', 'Routing request PO FQ2926', now()) returning id as t \gset
insert into public.emails (organization_id, thread_id, gmail_id, direction, from_email, subject, body_text, received_at, vendor_id)
values ('00000000-0000-0000-0000-000000000001', :'t', 'fq269-1', 'in', 'routing@fq269.example', 'Routing request PO FQ2926', 'TForce Freight $1,602.46', now() - interval '2 days', :'v') returning id as e1 \gset
select public.freight_quote_apply(:'e1', true, '{"carrier":"TForce Freight","cost":"1602.46"}'::jsonb, :'v', :'o', 'po') as q \gset
-- our email says the price we got
insert into public.emails (organization_id, thread_id, gmail_id, direction, from_email, to_emails, subject, body_text, received_at, vendor_id)
values ('00000000-0000-0000-0000-000000000001', :'t', 'fq269-2', 'out', :'box', array['routing@fq269.example'], 'Re: Routing request PO FQ2926', 'We got XPO for $1043, we will use them.', now() - interval '1 day', :'v') returning id as e2 \gset
select exists (select 1 from public.freight_quote_queue('00000000-0000-0000-0000-000000000001', 500) x where x.email_id = :'e2' and x.direction = 'out') as our_mail_queued;
select public.freight_our_choice(:'e2', 'XPO', 1043, :'v', :'o') = :'q' as same_quote;
select status = 'approved' and approved_choice = 'other' and approved_cost = 1043 and our_note like 'XPO $1,043.00: our own price%' as approved_at_our_price from public.freight_quotes where id = :'q';
select done_at is not null and done_note like 'VMS saw our price%' as task_closed from public.tasks where id = (select task_id from public.freight_quotes where id = :'q');
select freight_cost = 1043 as order_freight from public.orders where id = :'o';
-- saying it again makes no second quote
insert into public.emails (organization_id, thread_id, gmail_id, direction, from_email, to_emails, subject, body_text, received_at, vendor_id)
values ('00000000-0000-0000-0000-000000000001', :'t', 'fq269-3', 'out', :'box', array['steve@fq269.example'], 'Re: Routing request PO FQ2926', 'XPO for $1043', now(), :'v') returning id as e3 \gset
select public.freight_our_choice(:'e3', 'XPO', 1043, :'v', :'o') is null as no_second_quote;
select count(*) = 1 as one_quote from public.freight_quotes where order_id = :'o';

-- a vendor quote that came to the admin's own inbox: no text kept, the task is the owner's
insert into public.mailboxes (organization_id, kind, address, label, owner_id, gmail_box) values ('00000000-0000-0000-0000-000000000001', 'personal', 'fq269@ourshop.example', 'FQ', '11111111-1111-1111-1111-111111111111', 'fq269@ourshop.example') returning id as m \gset
insert into public.email_threads (organization_id, gmail_thread_id, subject, last_message_at, mailbox_id) values ('00000000-0000-0000-0000-000000000001', 'fq269p', 'Quote', now(), :'m') returning id as tp \gset
insert into public.emails (organization_id, thread_id, gmail_id, direction, from_email, subject, body_text, received_at, vendor_id, mailbox_id)
values ('00000000-0000-0000-0000-000000000001', :'tp', 'fq269-p', 'in', 'rep@fq269.example', 'Quote', 'Freight $200', now(), :'v', :'m') returning id as ep \gset
select public.freight_quote_apply(:'ep', true, '{"carrier":"UPS","cost":"200","details":{"notes":"private words"}}'::jsonb, :'v', null, null) as qp \gset
select details = '{}'::jsonb and vendor_cost = 200 as no_private_text from public.freight_quotes where id = :'qp';
select assigned_to = '11111111-1111-1111-1111-111111111111' as task_for_owner from public.tasks where id = (select task_id from public.freight_quotes where id = :'qp');

delete from public.tasks where vendor_id = :'v';
delete from public.freight_quotes where vendor_id = :'v';
delete from public.emails where thread_id in (:'t', :'tp');
delete from public.email_threads where id in (:'t', :'tp');
delete from public.mailboxes where id = :'m';
delete from public.orders where id = :'o';
delete from public.vendors where id = :'v';
