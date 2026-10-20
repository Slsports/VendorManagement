\set ON_ERROR_STOP on
\pset footer off
\echo '>>> Already in VMS from their email: the day the email came'
reset role;
select set_config('request.jwt.claims', '', false) is not null as service;
insert into public.vendors (organization_id, name) values ('00000000-0000-0000-0000-000000000001', 'DUP216') returning id as v \gset
insert into public.email_threads (organization_id, gmail_thread_id) values ('00000000-0000-0000-0000-000000000001', 't-216') returning id as th \gset
insert into public.emails (organization_id, gmail_id, thread_id, direction, subject, received_at) values ('00000000-0000-0000-0000-000000000001', 'g-216', :'th', 'in', 'Inv', '2026-03-05 18:00:00+00') returning id as e \gset
insert into public.vendor_links (organization_id, vendor_id, kind, label, storage_path, source, email_id, doc_number) values ('00000000-0000-0000-0000-000000000001', :'v', 'invoice', 'Inv', 'x/216.pdf', 'email', :'e', 'A-0216');
select public.invoice_doc_duplicate(:'v', 'invoice', 'a0216') = 'Already in VMS from their email, Mar 5, 2026' as email_day;
delete from public.order_checks where vendor_id = :'v';
delete from public.vendor_links where vendor_id = :'v';
delete from public.emails where id = :'e';
delete from public.email_threads where id = :'th';
delete from public.vendors where id = :'v';
