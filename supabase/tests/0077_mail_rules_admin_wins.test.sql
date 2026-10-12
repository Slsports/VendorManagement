\set ON_ERROR_STOP on
\pset footer off
\echo '>>> the admin has the last say: a manager cannot change the admin''s rule, only that one conversation'
reset role;
select id as admin_id from public.profiles where role = 'admin' and organization_id = '00000000-0000-0000-0000-000000000001' order by created_at limit 1 \gset
select id as other_id from public.profiles where role in ('manager', 'buyer') and organization_id = '00000000-0000-0000-0000-000000000001' order by created_at limit 1 \gset
insert into public.email_threads (organization_id, gmail_thread_id) values ('00000000-0000-0000-0000-000000000001', 'awt1'), ('00000000-0000-0000-0000-000000000001', 'awt2'), ('00000000-0000-0000-0000-000000000001', 'awt3');
insert into public.emails (organization_id, gmail_id, thread_id, direction, from_email, subject, received_at, is_bulk)
select '00000000-0000-0000-0000-000000000001', g, (select id from public.email_threads where gmail_thread_id = t), 'in', 'news@awtest.example', 'Hello', now(), true
from (values ('awm1', 'awt1'), ('awm2', 'awt2'), ('awm3', 'awt3')) x(g, t);
set role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', :'admin_id', 'role', 'authenticated')::text, false);
select public.set_email_thread_view((select id from public.email_threads where gmail_thread_id = 'awt1'), 'offers') as admin_moved;
select set_config('request.jwt.claims', json_build_object('sub', :'other_id', 'role', 'authenticated')::text, false);
select public.set_email_thread_view((select id from public.email_threads where gmail_thread_id = 'awt2'), 'attention') as other_moved;
reset role;
select gmail_thread_id, view from public.email_threads where gmail_thread_id like 'awt%' order by 1;
select view, created_by = :'admin_id' as admins_rule from public.mail_address_rules where address = 'news@awtest.example';
