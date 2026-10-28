\set ON_ERROR_STOP on
\pset footer off
\echo '>>> 0267: the morning mail email lists orders@ mail waiting on the person, once a day'
reset role;
select set_config('request.jwt.claims', '', false) is not null as service;
update public.profiles set remind_email = true where id = '33333333-3333-3333-3333-333333333333';
insert into public.email_threads (organization_id, gmail_thread_id, subject, last_message_at, last_in_at, owner_id, status, view)
values ('00000000-0000-0000-0000-000000000001', 'mm267-1', 'Needs you', now(), now() - interval '2 days', '33333333-3333-3333-3333-333333333333', 'waiting_on_us', 'attention'),
       ('00000000-0000-0000-0000-000000000001', 'mm267-2', 'No reply', now(), null, '33333333-3333-3333-3333-333333333333', 'waiting_on_vendor', 'attention'),
       ('00000000-0000-0000-0000-000000000001', 'mm267-3', 'Still time', now(), null, '33333333-3333-3333-3333-333333333333', 'waiting_on_vendor', 'attention'),
       ('00000000-0000-0000-0000-000000000001', 'mm267-4', 'Done', now(), null, '33333333-3333-3333-3333-333333333333', 'handled', 'attention');
update public.email_threads set follow_up_at = now() - interval '1 day' where gmail_thread_id = 'mm267-2';
update public.email_threads set follow_up_at = now() + interval '3 days' where gmail_thread_id = 'mm267-3';
select array_agg(subject order by subject) = array['Needs you', 'No reply'] as lists_waiting from public.mail_morning_list('33333333-3333-3333-3333-333333333333') l where l.thread_id in (select id from public.email_threads where gmail_thread_id like 'mm267-%');
-- before 8 AM nobody is due; the claim works once a day (the hour is checked against Pacific time, so test the claim directly)
update public.profiles set mail_morning_on = (now() at time zone 'America/Los_Angeles')::date where id = '33333333-3333-3333-3333-333333333333';
select not exists (select 1 from public.mail_morning_due() where profile_id = '33333333-3333-3333-3333-333333333333') as once_a_day;
delete from public.email_threads where gmail_thread_id like 'mm267-%';
