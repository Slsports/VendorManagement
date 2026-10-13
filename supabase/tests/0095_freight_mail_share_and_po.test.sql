\set ON_ERROR_STOP on
\pset footer off
\echo '>>> Freight mail: a freight company in a staff mailbox is shared; an email naming our PO is tagged to that vendor and order'
reset role;
select set_config('request.jwt.claims', '', false) is not null as service;
insert into public.vendors (organization_id, name) values ('00000000-0000-0000-0000-000000000001', 'PO Tag Test Vendor') returning id as v \gset
insert into public.orders (organization_id, vendor_id, status, po_number, order_date, source) values ('00000000-0000-0000-0000-000000000001', :'v', 'open', 'SONA-9126', current_date, 'email') returning id as o \gset
insert into public.email_senders (organization_id, sender_key, is_domain, kind) values ('00000000-0000-0000-0000-000000000001', 'freighttest.example', true, 'carrier') returning id as s \gset
insert into public.mailboxes (organization_id, kind, address, label, owner_id, gmail_box)
values ('00000000-0000-0000-0000-000000000001', 'personal', 'staff2@share.example', 'Staff', '22222222-2222-2222-2222-222222222222', 'staff2@share.example') returning id as mb \gset
insert into public.email_threads (organization_id, gmail_thread_id, mailbox_id) values ('00000000-0000-0000-0000-000000000001', 'po-t1', :'mb') returning id as t \gset
insert into public.emails (organization_id, thread_id, mailbox_id, gmail_id, direction, from_email, subject, body_text, received_at, sender_id)
values ('00000000-0000-0000-0000-000000000001', :'t', :'mb', 'po-1', 'in', 'quotes@freighttest.example', 'Quote request', 'Rate for PO SONA 9126, 3 cartons', now(), :'s') returning id as e \gset
select (select shared_at is not null from public.email_threads where id = :'t') as shared,
       exists (select 1 from public.email_vendor_tags where email_id = :'e' and vendor_id = :'v') as tagged,
       (select order_id = :'o' from public.emails where id = :'e') as on_order;
\echo '>>> a PO that is only part of a longer number is not a match'
insert into public.emails (organization_id, thread_id, gmail_id, direction, from_email, subject, body_text, received_at, sender_id)
values ('00000000-0000-0000-0000-000000000001', :'t', 'po-2', 'in', 'quotes@freighttest.example', 'Freight', 'PO XSONA-91267', now(), :'s') returning id as e2 \gset
select (select order_id is null from public.emails where id = :'e2') as not_matched;
delete from public.emails where gmail_id like 'po-%';
delete from public.email_threads where id = :'t';
delete from public.mailboxes where id = :'mb';
delete from public.email_senders where id = :'s';
delete from public.orders where id = :'o';
delete from public.vendors where id = :'v';
