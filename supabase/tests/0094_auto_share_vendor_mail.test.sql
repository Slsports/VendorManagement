\set ON_ERROR_STOP on
\pset footer off
\echo '>>> Auto-share: vendor mail in a staff mailbox is shared to Orders; the admin''s own mailbox and unshared ones are not'
reset role;
select set_config('request.jwt.claims', '', false) is not null as service;
insert into public.vendors (organization_id, name) values ('00000000-0000-0000-0000-000000000001', 'Share Test Vendor') returning id as v \gset
insert into public.email_senders (organization_id, sender_key, is_domain, kind, vendor_id) values ('00000000-0000-0000-0000-000000000001', 'sharetest.example', true, 'vendor', :'v') returning id as s \gset
insert into public.email_senders (organization_id, sender_key, is_domain, kind) values ('00000000-0000-0000-0000-000000000001', 'friend@sharetest-personal.example', false, 'unknown') returning id as s2 \gset
insert into public.mailboxes (organization_id, kind, address, label, owner_id, gmail_box)
values ('00000000-0000-0000-0000-000000000001', 'personal', 'staff@share.example', 'Staff', '22222222-2222-2222-2222-222222222222', 'staff@share.example') returning id as mb \gset
insert into public.mailboxes (organization_id, kind, address, label, owner_id, gmail_box, auto_share_vendor_mail)
values ('00000000-0000-0000-0000-000000000001', 'personal', 'boss@share.example', 'Boss', '33333333-3333-3333-3333-333333333333', 'boss@share.example', false) returning id as mb2 \gset
insert into public.email_threads (organization_id, gmail_thread_id, mailbox_id) values ('00000000-0000-0000-0000-000000000001', 'share-t1', :'mb') returning id as t1 \gset
insert into public.email_threads (organization_id, gmail_thread_id, mailbox_id) values ('00000000-0000-0000-0000-000000000001', 'share-t2', :'mb') returning id as t2 \gset
insert into public.email_threads (organization_id, gmail_thread_id, mailbox_id) values ('00000000-0000-0000-0000-000000000001', 'share-t3', :'mb2') returning id as t3 \gset
insert into public.emails (organization_id, thread_id, mailbox_id, gmail_id, direction, from_email, subject, received_at, sender_id)
values ('00000000-0000-0000-0000-000000000001', :'t1', :'mb', 'share-1', 'in', 'amy@sharetest.example', 'Your order', now(), :'s'),
       ('00000000-0000-0000-0000-000000000001', :'t2', :'mb', 'share-2', 'in', 'friend@sharetest-personal.example', 'Dinner?', now(), :'s2'),
       ('00000000-0000-0000-0000-000000000001', :'t3', :'mb2', 'share-3', 'in', 'amy@sharetest.example', 'Your order', now(), :'s');
select gmail_thread_id, shared_at is not null as shared from public.email_threads where id in (:'t1', :'t2', :'t3') order by 1;
\echo '>>> the friend is filed as a vendor later: their conversation is shared then'
update public.email_senders set kind = 'vendor', vendor_id = :'v' where id = :'s2';
select shared_at is not null as shared from public.email_threads where id = :'t2';
\echo '>>> unshared stays unshared when the vendor writes again'
update public.email_threads set shared_at = null, auto_share_off = true where id = :'t1';
insert into public.emails (organization_id, thread_id, mailbox_id, gmail_id, direction, from_email, subject, received_at, sender_id)
values ('00000000-0000-0000-0000-000000000001', :'t1', :'mb', 'share-4', 'in', 'amy@sharetest.example', 'Re: Your order', now(), :'s');
select shared_at is null as still_private from public.email_threads where id = :'t1';
delete from public.emails where gmail_id like 'share-%';
delete from public.email_threads where id in (:'t1', :'t2', :'t3');
delete from public.mailboxes where id in (:'mb', :'mb2');
delete from public.email_senders where id in (:'s', :'s2');
delete from public.vendors where id = :'v';
