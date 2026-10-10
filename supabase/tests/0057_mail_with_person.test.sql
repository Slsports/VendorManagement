\set ON_ERROR_STOP on
\pset footer off
\echo '>>> Mail with one person: from, to and cc, newest first; company widens; free mail stays the person'
reset role;
select id as admin_id from public.profiles where organization_id = '00000000-0000-0000-0000-000000000001' and role = 'admin' and is_active order by created_at limit 1 \gset
insert into public.email_threads (organization_id, gmail_thread_id) values ('00000000-0000-0000-0000-000000000001', 'mw-1') returning id as th \gset
insert into public.email_threads (organization_id, gmail_thread_id, deleted_at) values ('00000000-0000-0000-0000-000000000001', 'mw-2', now()) returning id as th2 \gset
insert into public.emails (organization_id, gmail_id, thread_id, direction, from_email, to_emails, cc_emails, received_at) values
  ('00000000-0000-0000-0000-000000000001', 'mw-a', :'th', 'in',  'Sue@Acme-Test.com', '{orders@shaverlakesports.com}', '{}', now() - interval '3 days'),
  ('00000000-0000-0000-0000-000000000001', 'mw-b', :'th', 'out', 'orders@shaverlakesports.com', '{sue@acme-test.com}', '{}', now() - interval '2 days'),
  ('00000000-0000-0000-0000-000000000001', 'mw-c', :'th', 'in',  'bob@acme-test.com', '{orders@shaverlakesports.com}', '{sue@acme-test.com}', now() - interval '1 day'),
  ('00000000-0000-0000-0000-000000000001', 'mw-d', :'th', 'in',  'tom@acme-test.com', '{orders@shaverlakesports.com}', '{}', now()),
  ('00000000-0000-0000-0000-000000000001', 'mw-e', :'th2', 'in', 'sue@acme-test.com', '{orders@shaverlakesports.com}', '{}', now()),
  ('00000000-0000-0000-0000-000000000001', 'mw-f', :'th', 'in',  'amy@gmail.com', '{orders@shaverlakesports.com}', '{}', now());
set role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', :'admin_id', 'role', 'authenticated')::text, false) is not null as as_admin;
select string_agg(from_email, ', ' order by received_at desc) as sue_newest_first from public.mail_with('00000000-0000-0000-0000-000000000001', 'sue@acme-test.com');
select count(*) as company from public.mail_with('00000000-0000-0000-0000-000000000001', 'sue@acme-test.com', true);
select count(*) as free_mail_stays_person from public.mail_with('00000000-0000-0000-0000-000000000001', 'amy@gmail.com', true);
reset role;
