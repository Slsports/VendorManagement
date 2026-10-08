\set ON_ERROR_STOP on
\pset footer off
\echo '>>> Working on order: flag, set Working, complete; the Team page counts it (admins only)'
reset role;
insert into public.email_threads (organization_id, gmail_thread_id, owner_id, status, last_in_at, last_message_at) values ('00000000-0000-0000-0000-000000000001', 'wk1', '33333333-3333-3333-3333-333333333333', 'waiting_on_us', now() - interval '4 days', now() - interval '4 days') returning id as wt \gset
select id as admin_id from public.profiles where organization_id = '00000000-0000-0000-0000-000000000001' and role = 'admin' and is_active order by created_at limit 1 \gset
set role authenticated;
select set_config('request.jwt.claims', '{"sub":"33333333-3333-3333-3333-333333333333","role":"authenticated"}', false);
select public.set_working_order(:'wt', 'flag');
reset role;
select working_by = '33333333-3333-3333-3333-333333333333'::uuid as mine, working_done_at is null as open from public.email_threads where id = :'wt';
set role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', :'admin_id', 'role', 'authenticated')::text, false) is not null as as_admin;
select needs, needs_oldest < now() - interval '3 days' as over_3_days, working, working_needs from public.team_overview('00000000-0000-0000-0000-000000000001') where profile_id = '33333333-3333-3333-3333-333333333333';
select set_config('request.jwt.claims', '{"sub":"33333333-3333-3333-3333-333333333333","role":"authenticated"}', false);
select public.set_working_order(:'wt', 'complete');
\echo '>>> not an admin: the Team page is empty'
select count(*) as rows_for_non_admin from public.team_overview('00000000-0000-0000-0000-000000000001');
reset role;
select working_done_at is not null as completed from public.email_threads where id = :'wt';
