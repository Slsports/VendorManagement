\set ON_ERROR_STOP on
\pset footer off
\echo '>>> Snooze: own rows only; a vendor reply wakes it'
reset role;
insert into public.email_threads (organization_id, gmail_thread_id) values ('00000000-0000-0000-0000-000000000001', 'snooze-thread') returning id as th \gset
select id as admin_id from public.profiles where organization_id = '00000000-0000-0000-0000-000000000001' and role = 'admin' and is_active order by created_at limit 1 \gset
set role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', :'admin_id', 'role', 'authenticated')::text, false) is not null as as_admin;
insert into public.snoozes (organization_id, profile_id, thread_id, until) values ('00000000-0000-0000-0000-000000000001', :'admin_id', :'th', now() + interval '2 days');
select count(*) as snoozed from public.snoozes where thread_id = :'th' and until > now();
reset role;
insert into public.emails (organization_id, gmail_id, thread_id, direction, received_at) values ('00000000-0000-0000-0000-000000000001', 'snooze-reply', :'th', 'in', now());
select until <= now() as awake, woke_by_reply from public.snoozes where thread_id = :'th';
