\set ON_ERROR_STOP on
\pset footer off
\echo '>>> Can see: a person sees and finishes the tasks of people Dana ticks; private mail and Accounting stay private; only the admin sets it'
reset role;
select set_config('request.jwt.claims', '', false) is not null as service;
insert into auth.users (id, email) values ('81818181-8181-8181-8181-818181818181', 'see-a@example.com'), ('82828282-8282-8282-8282-828282828282', 'see-b@example.com') on conflict do nothing;
insert into public.profiles (id, organization_id, email, full_name, role) values
  ('81818181-8181-8181-8181-818181818181', '00000000-0000-0000-0000-000000000001', 'see-a@example.com', 'See A', 'manager'),
  ('82828282-8282-8282-8282-828282828282', '00000000-0000-0000-0000-000000000001', 'see-b@example.com', 'See B', 'manager')
on conflict (id) do nothing;
insert into public.mailboxes (organization_id, kind, address, label, owner_id, gmail_box)
values ('00000000-0000-0000-0000-000000000001', 'personal', 'see-b@example.com', 'B', '82828282-8282-8282-8282-828282828282', 'see-b@example.com') returning id as mb \gset
insert into public.email_threads (organization_id, gmail_thread_id, mailbox_id) values ('00000000-0000-0000-0000-000000000001', 'see-private', :'mb') returning id as pt \gset
insert into public.tasks (organization_id, title, assigned_to, created_by) values ('00000000-0000-0000-0000-000000000001', 'B work', '82828282-8282-8282-8282-828282828282', '82828282-8282-8282-8282-828282828282') returning id as t1 \gset
insert into public.tasks (organization_id, title, assigned_to, created_by, thread_id) values ('00000000-0000-0000-0000-000000000001', 'B private', '82828282-8282-8282-8282-828282828282', '82828282-8282-8282-8282-828282828282', :'pt') returning id as t2 \gset
insert into public.tasks (organization_id, title, assigned_to, created_by, area) values ('00000000-0000-0000-0000-000000000001', 'B books', '82828282-8282-8282-8282-828282828282', '82828282-8282-8282-8282-828282828282', 'accounting') returning id as t3 \gset

-- A cannot see B's tasks yet, and cannot tick themselves
set role authenticated;
select set_config('request.jwt.claims', '{"sub":"81818181-8181-8181-8181-818181818181","role":"authenticated"}', false) is not null as a_in;
select count(*) = 0 as hidden_before from public.tasks where assigned_to = '82828282-8282-8282-8282-828282828282';
do $$ begin
  update public.profiles set can_see = array['82828282-8282-8282-8282-828282828282'::uuid] where id = '81818181-8181-8181-8181-818181818181';
  raise exception 'non-admin set can_see';
exception when insufficient_privilege then null; end $$;
do $$ begin
  update public.profiles set can_dnr = true where id = '81818181-8181-8181-8181-818181818181';
  raise exception 'non-admin set can_dnr';
exception when insufficient_privilege then null; end $$;

-- the admin ticks B for A (self and strangers are dropped)
select set_config('request.jwt.claims', '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}', false) is not null as admin_in;
update public.profiles set can_see = array['82828282-8282-8282-8282-828282828282'::uuid, '81818181-8181-8181-8181-818181818181'::uuid, gen_random_uuid()]
where id = '81818181-8181-8181-8181-818181818181';
reset role;
select can_see = array['82828282-8282-8282-8282-828282828282'::uuid] as cleaned from public.profiles where id = '81818181-8181-8181-8181-818181818181';

-- now A sees B's ordinary task only, takes it and finishes it
set role authenticated;
select set_config('request.jwt.claims', '{"sub":"81818181-8181-8181-8181-818181818181","role":"authenticated"}', false) is not null as a_in;
select array_agg(title order by title) = array['B work'] as sees_only_ordinary from public.tasks where assigned_to = '82828282-8282-8282-8282-828282828282';
update public.tasks set assigned_to = '81818181-8181-8181-8181-818181818181' where id = :'t1';
update public.tasks set assigned_to = '81818181-8181-8181-8181-818181818181' where id in (:'t2', :'t3');
select public.complete_task(:'t1') is null as finished;
reset role;
select (select done_by from public.tasks where id = :'t1') = '81818181-8181-8181-8181-818181818181' as done_by_a,
       (select assigned_to from public.tasks where id = :'t2') = '82828282-8282-8282-8282-828282828282' as private_untouched,
       (select assigned_to from public.tasks where id = :'t3') = '82828282-8282-8282-8282-828282828282' as accounting_untouched;

delete from public.tasks where id in (:'t1', :'t2', :'t3');
delete from public.email_threads where id = :'pt';
delete from public.mailboxes where id = :'mb';
delete from public.profiles where id in ('81818181-8181-8181-8181-818181818181', '82828282-8282-8282-8282-828282828282');
