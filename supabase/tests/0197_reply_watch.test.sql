\set ON_ERROR_STOP on
\pset footer off
\echo '>>> Tell me when they reply: the next email from them becomes a reminded task; old mail and private mail never fire it'
reset role;
select set_config('request.jwt.claims', '', false) is not null as service;
insert into auth.users (id, email) values ('97979797-9797-9797-9797-979797979797', 'watch-a@example.com'), ('98989898-9898-9898-9898-989898989898', 'watch-b@example.com') on conflict do nothing;
insert into public.profiles (id, organization_id, email, full_name, role) values
  ('97979797-9797-9797-9797-979797979797', '00000000-0000-0000-0000-000000000001', 'watch-a@example.com', 'Watch A', 'manager'),
  ('98989898-9898-9898-9898-989898989898', '00000000-0000-0000-0000-000000000001', 'watch-b@example.com', 'Watch B', 'manager')
on conflict (id) do nothing;
insert into public.mailboxes (organization_id, kind, address, label, owner_id, gmail_box)
values ('00000000-0000-0000-0000-000000000001', 'personal', 'watch-b@example.com', 'B', '98989898-9898-9898-9898-989898989898', 'watch-b@example.com') returning id as mb \gset
insert into public.email_threads (organization_id, gmail_thread_id) values ('00000000-0000-0000-0000-000000000001', 'w197-a') returning id as ta \gset
insert into public.email_threads (organization_id, gmail_thread_id) values ('00000000-0000-0000-0000-000000000001', 'w197-b') returning id as tb \gset
insert into public.email_threads (organization_id, gmail_thread_id, mailbox_id) values ('00000000-0000-0000-0000-000000000001', 'w197-p', :'mb') returning id as tp \gset

-- A watches Nichole from an orders@ email; setting it twice keeps one watch
set role authenticated;
select set_config('request.jwt.claims', '{"sub":"97979797-9797-9797-9797-979797979797","role":"authenticated"}', false) is not null as a_in;
select public.mail_watch_set(:'ta', ' Nichole197@Example.com ', 'Nichole Pence') as w1 \gset
select public.mail_watch_set(:'ta', 'nichole197@example.com') = :'w1' as same_watch;
select count(*) = 1 as a_sees_own from public.mail_watches where address = 'nichole197@example.com';
-- A cannot watch from B's private email
do $$ begin
  perform public.mail_watch_set((select id from public.email_threads where gmail_thread_id = 'w197-p'), 'x@example.com');
  raise exception 'watched from private mail';
exception when insufficient_privilege then null; end $$;
reset role;
select set_config('request.jwt.claims', '', false) is not null as service;

-- old mail from history (received before the watch) does not fire it
insert into public.emails (organization_id, gmail_id, thread_id, direction, from_email, from_name, subject, received_at) values
  ('00000000-0000-0000-0000-000000000001', 'w197-old', :'tb', 'in', 'nichole197@example.com', 'Nichole Pence', 'Old', now() - interval '30 days');
select fired_at is null as old_mail_ignored from public.mail_watches where id = :'w1';
-- her reply in B's private mail: A cannot open it, so it does not fire
insert into public.emails (organization_id, gmail_id, thread_id, mailbox_id, direction, from_email, subject, received_at) values
  ('00000000-0000-0000-0000-000000000001', 'w197-priv', :'tp', :'mb', 'in', 'nichole197@example.com', 'Private', now() + interval '1 minute');
select fired_at is null as private_ignored from public.mail_watches where id = :'w1';
-- her reply to orders@, in a new conversation: fires once, a task for A reminded now, opening that reply
insert into public.emails (organization_id, gmail_id, thread_id, direction, from_email, from_name, subject, received_at) values
  ('00000000-0000-0000-0000-000000000001', 'w197-new', :'tb', 'in', 'Nichole197@example.com', 'Nichole P', 'Save is fixed', now() + interval '2 minutes');
select fired_at is not null and task_id is not null as fired from public.mail_watches where id = :'w1';
select title = 'Reply from Nichole Pence' and assigned_to = '97979797-9797-9797-9797-979797979797' and thread_id = :'tb' and remind_at <= now() and auto_key = 'reply:' || :'w1' and area = 'general' as task_ok
  from public.tasks where id = (select task_id from public.mail_watches where id = :'w1');
-- a second email does not make a second task
insert into public.emails (organization_id, gmail_id, thread_id, direction, from_email, subject, received_at) values
  ('00000000-0000-0000-0000-000000000001', 'w197-again', :'tb', 'in', 'nichole197@example.com', 'And another', now() + interval '3 minutes');
select count(*) = 1 as one_task from public.tasks where auto_key = 'reply:' || :'w1';

-- stop: a new watch can be stopped by its watcher only
set role authenticated;
select set_config('request.jwt.claims', '{"sub":"98989898-9898-9898-9898-989898989898","role":"authenticated"}', false) is not null as b_in;
select public.mail_watch_set(:'tb', 'other197@example.com') as w2 \gset
select set_config('request.jwt.claims', '{"sub":"97979797-9797-9797-9797-979797979797","role":"authenticated"}', false) is not null as a_again;
select count(*) = 0 as a_cannot_see_b from public.mail_watches where id = :'w2';
select public.mail_watch_stop(:'w2');
select set_config('request.jwt.claims', '{"sub":"98989898-9898-9898-9898-989898989898","role":"authenticated"}', false) is not null as b_again;
select count(*) = 1 as still_there from public.mail_watches where id = :'w2';
select public.mail_watch_stop(:'w2');
select count(*) = 0 as stopped from public.mail_watches where id = :'w2';
reset role;
select set_config('request.jwt.claims', '', false) is not null as service;

delete from public.tasks where auto_key like 'reply:%' and assigned_to in ('97979797-9797-9797-9797-979797979797', '98989898-9898-9898-9898-989898989898');
delete from public.mail_watches where watcher in ('97979797-9797-9797-9797-979797979797', '98989898-9898-9898-9898-989898989898');
delete from public.emails where gmail_id like 'w197-%';
delete from public.email_threads where gmail_thread_id like 'w197-%';
delete from public.mailboxes where id = :'mb';
