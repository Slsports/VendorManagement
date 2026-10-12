\set ON_ERROR_STOP on
\pset footer off
\echo '>>> a move in a personal inbox teaches every inbox; the rule is private to that inbox'
reset role;
insert into public.mailboxes (organization_id, kind, address, label, owner_id, gmail_box)
values ('00000000-0000-0000-0000-000000000001', 'personal', 'shared-rule@example.com', 'Rule test', '22222222-2222-2222-2222-222222222222', 'shared-rule@example.com') returning id as mb \gset
insert into public.email_threads (organization_id, gmail_thread_id, mailbox_id) values ('00000000-0000-0000-0000-000000000001', 'srt1', :'mb');
insert into public.email_threads (organization_id, gmail_thread_id) values ('00000000-0000-0000-0000-000000000001', 'srt2');
insert into public.emails (organization_id, gmail_id, thread_id, mailbox_id, direction, from_email, subject, received_at, is_bulk)
values ('00000000-0000-0000-0000-000000000001', 'srm1', (select id from public.email_threads where gmail_thread_id = 'srt1'), :'mb', 'in', 'deals@srtest.example', 'Hello', now(), true),
       ('00000000-0000-0000-0000-000000000001', 'srm2', (select id from public.email_threads where gmail_thread_id = 'srt2'), null, 'in', 'deals@srtest.example', 'Hello again', now(), true);
update public.emails set view = 'attention', view_how = 'signals' where gmail_id like 'srm%';
update public.email_threads set view = 'attention' where gmail_thread_id like 'srt%';
set role authenticated;
select set_config('request.jwt.claims', '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}', false);
select public.set_email_thread_view((select id from public.email_threads where gmail_thread_id = 'srt1'), 'offers') as orders_mail_moved;
reset role;
select gmail_thread_id, view from public.email_threads where gmail_thread_id like 'srt%' order by 1;
select address, view, mailbox_id = :'mb' as private_rule from public.mail_address_rules where address = 'deals@srtest.example';
\echo '>>> moving it back in orders@ wins for everyone'
set role authenticated;
select set_config('request.jwt.claims', '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}', false);
select public.set_email_thread_view((select id from public.email_threads where gmail_thread_id = 'srt2'), 'attention') as moved;
reset role;
select count(*) as rules, min(view) as view, bool_and(mailbox_id is null) as now_shared from public.mail_address_rules where address = 'deals@srtest.example';
