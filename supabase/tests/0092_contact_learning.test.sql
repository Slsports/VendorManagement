\set ON_ERROR_STOP on
\pset footer off
\echo '>>> Contact learning: people who write from a vendor domain are queued once; our own domain and private mail are not'
reset role;
insert into public.vendors (organization_id, name) values ('00000000-0000-0000-0000-000000000001', 'Learn Test Vendor') returning id as v \gset
insert into public.email_senders (organization_id, sender_key, is_domain, kind, vendor_id) values ('00000000-0000-0000-0000-000000000001', 'learntest.example', true, 'vendor', :'v') returning id as s \gset
insert into public.email_threads (organization_id, gmail_thread_id) values ('00000000-0000-0000-0000-000000000001', 'learn-thread') returning id as t \gset
insert into public.emails (organization_id, thread_id, gmail_id, direction, from_email, from_name, to_emails, subject, body_text, received_at, sender_id, vendor_id)
values ('00000000-0000-0000-0000-000000000001', :'t', 'learn-1', 'in', 'Jasmin@learntest.example', 'Jasmin Escobar', '{}', 'Your order', E'Hi\nJasmin Escobar\nCustomer Service\nCell 559-555-0100', now() - interval '2 days', :'s', :'v'),
       ('00000000-0000-0000-0000-000000000001', :'t', 'learn-2', 'out', 'orders@shaverlakesports.com', null, array['rick@learntest.example', 'someone@other.example'], 'Re: Your order', 'Thanks Rick', now() - interval '1 day', null, :'v');
select email, vendor_id = :'v' as vendor, jsonb_array_length(emails) as emails from public.contact_learn_queue('00000000-0000-0000-0000-000000000001', 50) where email like '%learntest.example' order by 1;
insert into public.contact_learning (organization_id, email, vendor_id, result) values ('00000000-0000-0000-0000-000000000001', 'jasmin@learntest.example', :'v', 'added');
select count(*) as still_queued from public.contact_learn_queue('00000000-0000-0000-0000-000000000001', 50) where email = 'jasmin@learntest.example';
\echo '>>> not for signed-in users'
set role authenticated;
select set_config('request.jwt.claims', '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}', true);
\set ON_ERROR_STOP off
select count(*) from public.contact_learn_queue('00000000-0000-0000-0000-000000000001', 5);
\set ON_ERROR_STOP on
reset role;
delete from public.emails where gmail_id like 'learn-%';
delete from public.email_threads where id = :'t';
delete from public.contact_learning where vendor_id = :'v';
delete from public.email_senders where id = :'s';
delete from public.vendors where id = :'v';
