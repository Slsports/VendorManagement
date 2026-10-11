\set ON_ERROR_STOP on
\pset footer off
\echo '>>> Tasks: mine, given or admin; repeating tasks make the next one'
reset role;
select id as admin_id from public.profiles where organization_id = '00000000-0000-0000-0000-000000000001' and role = 'admin' and is_active order by created_at limit 1 \gset
insert into auth.users (id, email) values ('11111111-2222-3333-4444-555555555555', 'mbx-mgr@example.com') on conflict do nothing;
insert into public.profiles (id, organization_id, email, full_name, role, is_active) values ('11111111-2222-3333-4444-555555555555', '00000000-0000-0000-0000-000000000001', 'mbx-mgr@example.com', 'Morgan Test', 'manager', true) on conflict (id) do update set role = 'manager', organization_id = excluded.organization_id, is_active = true;
insert into auth.users (id, email) values ('66666666-2222-3333-4444-555555555555', 'mbx-other@example.com') on conflict do nothing;
insert into public.profiles (id, organization_id, email, full_name, role, is_active) values ('66666666-2222-3333-4444-555555555555', '00000000-0000-0000-0000-000000000001', 'mbx-other@example.com', 'Other Test', 'manager', true) on conflict (id) do update set role = 'manager', organization_id = excluded.organization_id, is_active = true;

-- next due dates
select public.task_next_due('2026-10-12', 1, 'week') = '2026-10-19' as weekly,
       public.task_next_due('2026-10-12', 2, 'week', '{1,4}') = '2026-10-15' as mon_thu_same_week,
       public.task_next_due('2026-10-15', 2, 'week', '{1,4}') = '2026-10-26' as thu_to_monday_two_weeks_on,
       public.task_next_due('2026-01-31', 1, 'month') = '2026-02-28' as month_end,
       public.task_next_due('2026-10-12', 3, 'day') = '2026-10-15' as three_days,
       public.task_next_due('2026-10-12', 1, 'year') = '2027-10-12' as yearly;

-- the admin gives Morgan a repeating task
set role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', :'admin_id', 'role', 'authenticated')::text, false) is not null as as_admin;
insert into public.tasks (organization_id, title, due_date, remind_at, assigned_to, repeat_every, repeat_unit)
values ('00000000-0000-0000-0000-000000000001', 'Call the rep', current_date, (current_date + time '09:00')::timestamptz, '11111111-2222-3333-4444-555555555555', 1, 'week')
returning id as t1, created_by = :'admin_id' as giver_is_admin \gset
select :'giver_is_admin' as giver_is_admin;

-- someone else does not see it; Morgan does and finishes it
select set_config('request.jwt.claims', '{"sub":"66666666-2222-3333-4444-555555555555","role":"authenticated"}', false) is not null as as_other;
select count(*) as other_sees from public.tasks where id = :'t1';
select set_config('request.jwt.claims', '{"sub":"11111111-2222-3333-4444-555555555555","role":"authenticated"}', false) is not null as as_morgan;
select count(*) as morgan_sees from public.tasks where id = :'t1';
select public.complete_task(:'t1', 'Left a message') as t2 \gset
reset role;
select done_at is not null as done, done_notified_at is null as giver_to_be_told, done_note from public.tasks where id = :'t1';
select due_date = current_date + 7 as next_week, remind_at = (current_date + 7 + time '09:00')::timestamptz as remind_moves,
       created_by = :'admin_id' as same_giver, repeat_of = :'t1' as linked, assigned_to = '11111111-2222-3333-4444-555555555555' as same_person
from public.tasks where id = :'t2';

-- a new remind time sends a new reminder; finishing your own task tells nobody
update public.tasks set reminded_at = now() where id = :'t2';
update public.tasks set remind_at = remind_at + interval '1 hour' where id = :'t2';
select reminded_at is null as reminds_again from public.tasks where id = :'t2';
set role authenticated;
select set_config('request.jwt.claims', '{"sub":"11111111-2222-3333-4444-555555555555","role":"authenticated"}', false) is not null as as_morgan_again;
insert into public.tasks (organization_id, title, assigned_to) values ('00000000-0000-0000-0000-000000000001', 'My own', '11111111-2222-3333-4444-555555555555') returning id as t3 \gset
select public.complete_task(:'t3') is null as no_repeat;
select done_notified_at is not null as nobody_told from public.tasks where id = :'t3';
reset role;
delete from public.tasks where id in (:'t1', :'t2', :'t3');
