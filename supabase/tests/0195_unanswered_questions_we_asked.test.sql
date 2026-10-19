\set ON_ERROR_STOP on
\pset footer off
\echo '>>> Questions we asked from history: queued when nobody answered; a yes shows as No answer yet; a no stays handled'
reset role;
select set_config('request.jwt.claims', '', false) is not null as service;
insert into public.email_threads (organization_id, gmail_thread_id, status) values ('00000000-0000-0000-0000-000000000001', 'q195-a', 'handled') returning id as ta \gset
insert into public.email_threads (organization_id, gmail_thread_id, status) values ('00000000-0000-0000-0000-000000000001', 'q195-b', 'handled') returning id as tb \gset
insert into public.email_threads (organization_id, gmail_thread_id, status) values ('00000000-0000-0000-0000-000000000001', 'q195-c', 'handled') returning id as tc \gset
-- a: we asked a month ago, read in today, no answer
insert into public.emails (organization_id, gmail_id, thread_id, direction, from_email, to_emails, subject, body_text, received_at) values
  ('00000000-0000-0000-0000-000000000001', 'q195-a1', :'ta', 'out', 'orders@example.com', array['rep195@example.com'], 'Ship date?', 'Can you confirm the ship date?', now() - interval '30 days') returning id as ea \gset
-- b: we asked, and they answered in another thread
insert into public.emails (organization_id, gmail_id, thread_id, direction, from_email, to_emails, subject, received_at) values
  ('00000000-0000-0000-0000-000000000001', 'q195-b1', :'tb', 'out', 'orders@example.com', array['Ans195@example.com'], 'Tracking?', now() - interval '30 days');
insert into public.emails (organization_id, gmail_id, thread_id, direction, from_email, subject, received_at) values
  ('00000000-0000-0000-0000-000000000001', 'q195-b2', :'tc', 'in', 'ans195@example.com', 'Tracking 1Z', now() - interval '28 days');
-- c: a live thread closed by a person (stored when it was sent): never queued
insert into public.emails (organization_id, gmail_id, thread_id, direction, from_email, to_emails, subject, received_at, created_at) values
  ('00000000-0000-0000-0000-000000000001', 'q195-c1', :'tc', 'out', 'orders@example.com', array['live195@example.com'], 'Thanks', now() - interval '20 days', now() - interval '20 days');
select array_agg(subject) = array['Ship date?'] as only_a_queued from public.mail_unanswered_out_queue('00000000-0000-0000-0000-000000000001', 50) where subject in ('Ship date?', 'Tracking?', 'Thanks');
select public.mail_apply_expects_reply(:'ea', true) = 'no_answer' as applied;
select status = 'waiting_on_vendor' and follow_up_at < now() as shows_no_answer_yet from public.email_threads where id = :'ta';
select count(*) = 0 as no_task from public.tasks where thread_id = :'ta';
select count(*) = 0 as not_queued_again from public.mail_unanswered_out_queue('00000000-0000-0000-0000-000000000001', 50) where email_id = :'ea';
delete from public.emails where gmail_id like 'q195-%';
delete from public.email_threads where gmail_thread_id like 'q195-%';
