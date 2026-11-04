\set ON_ERROR_STOP on
\pset footer off
\echo '>>> 0309: Bill.com forwarding turns on when the vendor bills billing@ directly'
reset role;
select set_config('request.jwt.claims', '', false) is not null as service;
insert into public.vendors (organization_id, name, billcom_auto_on_from) values ('00000000-0000-0000-0000-000000000001', 'EJ309 DIST', 'old309@gmail.example') returning id as v \gset
insert into public.vendors (organization_id, name, billcom_auto_on_from, parent_company) values ('00000000-0000-0000-0000-000000000001', 'ST309 SAWS', 'old309@gmail.example', 'EJ309 DIST') returning id as s \gset
insert into public.email_threads (organization_id, gmail_thread_id) values ('00000000-0000-0000-0000-000000000001', 'bc309') returning id as th \gset
\echo '>>> still forwarded through the old address: nothing'
insert into public.emails (organization_id, thread_id, gmail_id, direction, from_email, to_emails, subject, received_at, vendor_id, gmail_box, delivered_to)
values ('00000000-0000-0000-0000-000000000001', :'th', 'bc309-1', 'in', 'noreply@ej309.example', '{}', 'Invoice', now(), :'v', 'billing@shaverlakesports.com', array['old309@gmail.example', 'billing@shaverlakesports.com']);
select not billcom_send and billcom_auto_on_from is not null as still_off from public.vendors where id = :'v';
\echo '>>> an old email with no delivery address saved: nothing'
insert into public.emails (organization_id, thread_id, gmail_id, direction, from_email, to_emails, subject, received_at, vendor_id, gmail_box)
values ('00000000-0000-0000-0000-000000000001', :'th', 'bc309-2', 'in', 'noreply@ej309.example', '{}', 'Invoice', now(), :'v', 'billing@shaverlakesports.com');
select not billcom_send as still_off_2 from public.vendors where id = :'v';
\echo '>>> straight to billing@: on for the vendor and the one it bills, and a task'
insert into public.emails (organization_id, thread_id, gmail_id, direction, from_email, to_emails, subject, received_at, vendor_id, gmail_box, delivered_to)
values ('00000000-0000-0000-0000-000000000001', :'th', 'bc309-3', 'in', 'noreply@ej309.example', '{}', 'Invoice', now(), :'v', 'billing@shaverlakesports.com', array['billing@shaverlakesports.com']);
select billcom_send and billcom_auto_on_from is null as ejd_on from public.vendors where id = :'v';
select billcom_send and billcom_auto_on_from is null as stihl_on from public.vendors where id = :'s';
select count(*) = 1 as one_task from public.tasks where auto_key = 'billcom_auto:' || :'v';
delete from public.tasks where auto_key = 'billcom_auto:' || :'v';
delete from public.emails where gmail_id like 'bc309-%';
delete from public.email_threads where id = :'th';
delete from public.vendors where id in (:'v', :'s');
