\set ON_ERROR_STOP on
\pset footer off
\echo '>>> 0264: a delay email in a personal inbox makes its task only for the inbox owner'
reset role;
select set_config('request.jwt.claims', '', false) is not null as service;
insert into public.vendors (organization_id, name) values ('00000000-0000-0000-0000-000000000001', 'DL264 SPORTS') returning id as v \gset
insert into public.mailboxes (organization_id, kind, address, label, owner_id, gmail_box) values ('00000000-0000-0000-0000-000000000001', 'personal', 'dl264@ourshop.example', 'DL', '33333333-3333-3333-3333-333333333333', 'dl264@ourshop.example') returning id as m \gset
insert into public.email_threads (organization_id, gmail_thread_id, subject, last_message_at, mailbox_id, owner_id) values ('00000000-0000-0000-0000-000000000001', 'dl264', 'Delays', now(), :'m', '11111111-1111-1111-1111-111111111111') returning id as t \gset
insert into public.emails (organization_id, thread_id, gmail_id, direction, from_email, subject, received_at, vendor_id, mailbox_id)
values ('00000000-0000-0000-0000-000000000001', :'t', 'dl264-1', 'in', 'rep@dl264.example.com', 'Delays', now() - interval '20 days', :'v', :'m') returning id as e \gset
update public.emails set ship_status = 'exception' where id = :'e';
select assigned_to = '33333333-3333-3333-3333-333333333333' as only_the_inbox_owner from public.tasks where auto_key = 'shipupd:' || :'e';
delete from public.tasks where auto_key = 'shipupd:' || :'e';
delete from public.emails where thread_id = :'t';
delete from public.email_threads where id = :'t';
delete from public.mailboxes where id = :'m';
delete from public.vendors where id = :'v';
