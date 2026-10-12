\set ON_ERROR_STOP on
\pset footer off
\echo '>>> an Other sender that is a freight company joins Other freight companies; its mail is freight mail'
reset role;
insert into public.email_senders (organization_id, sender_key, is_domain, kind) values ('00000000-0000-0000-0000-000000000001', 'notify.shiptest.example', true, 'not_vendor') returning id as fs \gset
insert into public.email_threads (organization_id, gmail_thread_id) values ('00000000-0000-0000-0000-000000000001', 'oft1') returning id as ft \gset
insert into public.emails (organization_id, gmail_id, thread_id, direction, from_email, subject, received_at, sender_id)
values ('00000000-0000-0000-0000-000000000001', 'ofm1', :'ft', 'in', 'track@notify.shiptest.example', 'Your package is on the way', now(), :'fs');
select public.mail_sender_to_freight(:'fs', 'ShipTest') is not null as made;
select name, role, email_domains from public.carriers where name = 'ShipTest';
select kind, carrier_id = (select id from public.carriers where name = 'ShipTest') as filed from public.email_senders where id = :'fs';
select carrier_id = (select id from public.carriers where name = 'ShipTest') as freight_thread from public.email_threads where id = :'ft';
\echo '>>> Claude''s "carrier" answer does the same for an unknown sender, and reuses the company'
insert into public.email_senders (organization_id, sender_key, is_domain) values ('00000000-0000-0000-0000-000000000001', 'mail.shiptest.example', true) returning id as fs2 \gset
select public.mail_apply_sender_sort(:'fs2', 'carrier', null, 'ShipTest', null, null, 'tracking notices') as sorted;
select count(*) as shiptest_rows from public.carriers where name = 'ShipTest';
