\set ON_ERROR_STOP on
\pset footer off
\echo '>>> Service orders: a vendor by name; order emails from NuORDER are queued, shipping notices and replies are not'
reset role;
insert into public.vendors (organization_id, name, aliases) values ('00000000-0000-0000-0000-000000000001', 'Gold Medal International Test', array['GMI Test Brand']) returning id as v \gset
select public.vendor_by_name('00000000-0000-0000-0000-000000000001', 'Gold Medal International Test, Inc.') = :'v' as by_name,
       public.vendor_by_name('00000000-0000-0000-0000-000000000001', 'GMI Test Brand') = :'v' as by_alias,
       public.vendor_by_name('00000000-0000-0000-0000-000000000001', 'Nobody Like This Co') is null as unknown;
insert into public.email_threads (organization_id, gmail_thread_id) values ('00000000-0000-0000-0000-000000000001', 'svc-test-thread') returning id as t \gset
insert into public.emails (organization_id, thread_id, gmail_id, direction, from_email, subject, received_at)
values ('00000000-0000-0000-0000-000000000001', :'t', 'svc-test-1', 'in', 'hello@nuorder.com', 'Gold Medal International Order #281069178 for Shaver Lake Sports Inc #816 has been SUBMITTED', now() - interval '1 day'),
       ('00000000-0000-0000-0000-000000000001', :'t', 'svc-test-2', 'in', 'updates@info.faire.com', 'Chase USA shipped your order!', now() - interval '1 day'),
       ('00000000-0000-0000-0000-000000000001', :'t', 'svc-test-3', 'in', 'amy@vendor.example', 'Re: Your order has been received', now() - interval '1 day');
select e.gmail_id from public.service_order_queue('00000000-0000-0000-0000-000000000001', 500) q join public.emails e on e.id = q.email_id where e.gmail_id like 'svc-test-%' order by 1;
\echo '>>> not for signed-in users'
set role authenticated;
select set_config('request.jwt.claims', '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}', true);
\set ON_ERROR_STOP off
select public.service_order_queue('00000000-0000-0000-0000-000000000001', 5);
\set ON_ERROR_STOP on
reset role;
delete from public.emails where gmail_id like 'svc-test-%';
delete from public.email_threads where id = :'t';
delete from public.vendors where id = :'v';
