\set ON_ERROR_STOP on
\pset footer off
\echo '>>> mail platforms: a NetSuite-style sender answered "many vendors" links each email by the one vendor it names'
reset role;
insert into public.vendors (organization_id, name) values ('00000000-0000-0000-0000-000000000001', 'Platform Vendor One') returning id as pv1 \gset
insert into public.vendors (organization_id, name) values ('00000000-0000-0000-0000-000000000001', 'Platform Vendor Two') returning id as pv2 \gset
insert into public.email_senders (organization_id, sender_key) values ('00000000-0000-0000-0000-000000000001', 'sent-via.example-erp.com') returning id as ps \gset
insert into public.email_threads (organization_id, gmail_thread_id) values ('00000000-0000-0000-0000-000000000001', 'pt1'), ('00000000-0000-0000-0000-000000000001', 'pt2'), ('00000000-0000-0000-0000-000000000001', 'pt3');
insert into public.emails (organization_id, gmail_id, thread_id, direction, from_email, subject, received_at, sender_id, mentioned_vendor_ids)
select '00000000-0000-0000-0000-000000000001', g, (select id from public.email_threads where gmail_thread_id = t), 'in', 'noreply@sent-via.example-erp.com', s, now(), :'ps', m
from (values ('pm1', 'pt1', 'Invoice from Platform Vendor One', array[:'pv1']::uuid[]),
             ('pm2', 'pt2', 'Invoice from Platform Vendor Two', array[:'pv2']::uuid[]),
             ('pm3', 'pt3', 'Statement', array[:'pv1', :'pv2']::uuid[])) x(g, t, s, m);
select public.mail_process('00000000-0000-0000-0000-000000000001', (select array_agg(id) from public.emails where gmail_id like 'pm%'), false) as processed;
select title from public.review_items where entity_id = :'ps';
set role authenticated;
select set_config('request.jwt.claims', '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}', false);
select public.resolve_email_sender(:'ps', 'platform') as linked;
select gmail_id, case vendor_id when :'pv1' then 'one' when :'pv2' then 'two' else 'none' end as vendor, match_how from public.emails where gmail_id like 'pm%' order by gmail_id;
reset role;
\echo '>>> one passing mention is not a proposal'
insert into public.email_senders (organization_id, sender_key) values ('00000000-0000-0000-0000-000000000001', 'freight-broker.example') returning id as fb \gset
insert into public.email_threads (organization_id, gmail_thread_id) values ('00000000-0000-0000-0000-000000000001', 'fb1');
insert into public.emails (organization_id, gmail_id, thread_id, direction, from_email, subject, received_at, sender_id, mentioned_vendor_ids)
select '00000000-0000-0000-0000-000000000001', 'fb' || g, (select id from public.email_threads where gmail_thread_id = 'fb1'), 'in', 'quotes@freight-broker.example', 'Quote', now(), :'fb',
       case when g = 1 then array[:'pv1']::uuid[] else '{}'::uuid[] end
from generate_series(1, 5) g;
select public.mail_process('00000000-0000-0000-0000-000000000001', (select array_agg(id) from public.emails where gmail_id like 'fb%'), false) as processed;
select title from public.review_items where entity_id = :'fb';
