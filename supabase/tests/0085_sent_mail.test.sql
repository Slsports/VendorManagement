\set ON_ERROR_STOP on
\pset footer off
\echo '>>> Sent: our emails, newest first, found by address, subject or vendor'
reset role;
insert into public.vendors (organization_id, name) values ('00000000-0000-0000-0000-000000000001', 'Sent Test Deluxe') returning id as sv \gset
insert into public.email_threads (organization_id, gmail_thread_id, vendor_id) values ('00000000-0000-0000-0000-000000000001', 'stt1', :'sv') returning id as st \gset
insert into public.emails (organization_id, gmail_id, thread_id, direction, from_email, to_emails, subject, received_at, vendor_id)
values ('00000000-0000-0000-0000-000000000001', 'stm1', :'st', 'out', 'orders@example.com', array['barry@senttest.example'], 'Fall order', now() - interval '1 day', :'sv'),
       ('00000000-0000-0000-0000-000000000001', 'stm2', :'st', 'in', 'barry@senttest.example', array['orders@example.com'], 'Re: Fall order', now(), :'sv');
set role authenticated;
select set_config('request.jwt.claims', '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}', false);
select subject, vendor_name from public.list_sent_emails('00000000-0000-0000-0000-000000000001', null, null, 'barry');
select count(*) as by_vendor from public.list_sent_emails('00000000-0000-0000-0000-000000000001', null, :'sv', null);
select count(*) as by_vendor_name from public.list_sent_emails('00000000-0000-0000-0000-000000000001', null, null, 'Sent Test');
reset role;
