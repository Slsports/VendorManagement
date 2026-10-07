\set ON_ERROR_STOP on
\pset footer off
\echo '>>> a rep writing from her address on file is her rep group at once; each email files to the line it names'
reset role;
insert into public.rep_groups (organization_id, name, email) values ('00000000-0000-0000-0000-000000000001', 'Test Rep Agency', 'testrep@gmail.com') returning id as rg \gset
insert into public.vendors (organization_id, name, rep_group_id) values ('00000000-0000-0000-0000-000000000001', 'Rep Line One', :'rg') returning id as r1 \gset
insert into public.vendors (organization_id, name, rep_group_id) values ('00000000-0000-0000-0000-000000000001', 'Rep Line Two', :'rg') returning id as r2 \gset
insert into public.email_senders (organization_id, sender_key, is_domain) values ('00000000-0000-0000-0000-000000000001', 'testrep@gmail.com', false) returning id as rs \gset
insert into public.email_threads (organization_id, gmail_thread_id) values ('00000000-0000-0000-0000-000000000001', 'rt1'), ('00000000-0000-0000-0000-000000000001', 'rt2');
insert into public.emails (organization_id, gmail_id, thread_id, direction, from_email, subject, received_at, sender_id, mentioned_vendor_ids)
values ('00000000-0000-0000-0000-000000000001', 'rm1', (select id from public.email_threads where gmail_thread_id = 'rt1'), 'in', 'testrep@gmail.com', 'Line One closeouts', now(), :'rs', array[:'r1']::uuid[]),
       ('00000000-0000-0000-0000-000000000001', 'rm2', (select id from public.email_threads where gmail_thread_id = 'rt2'), 'in', 'testrep@gmail.com', 'Both lines', now(), :'rs', array[:'r1', :'r2']::uuid[]);
select public.mail_process('00000000-0000-0000-0000-000000000001', (select array_agg(id) from public.emails where gmail_id like 'rm%'), false) as processed;
select kind, rep_group_id = :'rg' as is_rep from public.email_senders where id = :'rs';
select gmail_id, case vendor_id when :'r1' then 'one' when :'r2' then 'two' else 'not filed' end as vendor from public.emails where gmail_id like 'rm%' order by 1;
select count(*) as open_cards from public.review_items where entity_id = :'rs' and status = 'pending';
