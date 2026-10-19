\set ON_ERROR_STOP on
\pset footer off
\echo '>>> History: old mail is handled only when answered, or old, or ours last; unanswered recent questions wait on us; no cards'
reset role;
select set_config('request.jwt.claims', '', false) is not null as service;
-- four old threads read in from history
insert into public.email_threads (organization_id, gmail_thread_id) values ('00000000-0000-0000-0000-000000000001', 'h190-a') returning id as ta \gset
insert into public.email_threads (organization_id, gmail_thread_id) values ('00000000-0000-0000-0000-000000000001', 'h190-b') returning id as tb \gset
insert into public.email_threads (organization_id, gmail_thread_id) values ('00000000-0000-0000-0000-000000000001', 'h190-c') returning id as tc \gset
insert into public.email_threads (organization_id, gmail_thread_id) values ('00000000-0000-0000-0000-000000000001', 'h190-d') returning id as td \gset
-- a: a question 2 months ago, nobody answered
insert into public.emails (organization_id, gmail_id, thread_id, direction, from_email, subject, received_at) values
  ('00000000-0000-0000-0000-000000000001', 'h190-a1', :'ta', 'in', 'rep190@example.com', 'Can you confirm the order?', now() - interval '60 days') returning id as ea \gset
-- b: a question 1 month ago that we answered in a NEW email to that person (another thread)
insert into public.emails (organization_id, gmail_id, thread_id, direction, from_email, subject, received_at) values
  ('00000000-0000-0000-0000-000000000001', 'h190-b1', :'tb', 'in', 'other190@example.com', 'Need your PO', now() - interval '30 days') returning id as eb \gset
insert into public.emails (organization_id, gmail_id, thread_id, direction, from_email, to_emails, subject, received_at) values
  ('00000000-0000-0000-0000-000000000001', 'h190-b2', :'td', 'out', 'orders@example.com', array['Other190@example.com'], 'PO 123', now() - interval '29 days');
-- c: a question 8 months ago, nobody answered (too old to matter)
insert into public.emails (organization_id, gmail_id, thread_id, direction, from_email, subject, received_at) values
  ('00000000-0000-0000-0000-000000000001', 'h190-c1', :'tc', 'in', 'old190@example.com', 'Price list?', now() - interval '240 days') returning id as ec \gset
select public.mail_answered(:'ea') = false as a_unanswered, public.mail_answered(:'eb') = true as b_answered_elsewhere;
select public.mail_refresh_thread(:'ta', true), public.mail_refresh_thread(:'tb', true), public.mail_refresh_thread(:'tc', true), public.mail_refresh_thread(:'td', true);
select (select status from public.email_threads where id = :'ta') = 'waiting_on_us' as a_needs_answer,
       (select status from public.email_threads where id = :'tb') = 'handled' as b_handled,
       (select status from public.email_threads where id = :'tc') = 'handled' as c_too_old,
       (select status from public.email_threads where id = :'td') = 'handled' as d_ours_last,
       (select follow_up_at from public.email_threads where id = :'td') is null as d_no_follow_up;
-- the reply check is unsure about the old one: it stays in Needs an answer, no card
select public.mail_apply_reply(:'ea', 'unsure', 'maybe', null, null) = 'needs' as unsure_stays;
select count(*) = 0 as no_card from public.review_items where kind = 'mail_reply' and entity_id = :'ta';
-- the back-check: the old rule had closed a; it opens again, c stays closed
update public.email_threads set status = 'handled' where id in (:'ta', :'tc');
update public.emails set reply_read_at = null where id = :'ea';
select (public.mail_reopen_unanswered('00000000-0000-0000-0000-000000000001')->>'reopened')::int >= 1 as reopened;
select (select status from public.email_threads where id = :'ta') = 'waiting_on_us' as a_back,
       (select status from public.email_threads where id = :'tc') = 'handled' as c_stays;
delete from public.emails where gmail_id like 'h190-%';
delete from public.email_threads where gmail_thread_id like 'h190-%';
