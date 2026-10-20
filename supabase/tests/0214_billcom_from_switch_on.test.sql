\set ON_ERROR_STOP on
\pset footer off
\echo '>>> Bill.com: only invoices emailed after the switch went on are forwarded'
reset role;
select set_config('request.jwt.claims', '', false) is not null as service;
insert into public.vendors (organization_id, name) values ('00000000-0000-0000-0000-000000000001', 'Billcom214 Co') returning id as v \gset
select billcom_send_on_at is null as off_has_no_date from public.vendors where id = :'v';
update public.vendors set billcom_send = true where id = :'v';
select billcom_send_on_at is not null as on_date_set from public.vendors where id = :'v';
insert into public.email_threads (organization_id, gmail_thread_id) values ('00000000-0000-0000-0000-000000000001', 't-billcom-214') returning id as th \gset
insert into public.emails (organization_id, gmail_id, thread_id, direction, from_email, subject, received_at) values ('00000000-0000-0000-0000-000000000001', 'g-214-old', :'th', 'in', 'ar@b214.com', 'Old invoice', now() - interval '60 days') returning id as e_old \gset
insert into public.emails (organization_id, gmail_id, thread_id, direction, from_email, subject, received_at) values ('00000000-0000-0000-0000-000000000001', 'g-214-new', :'th', 'in', 'ar@b214.com', 'New invoice', now()) returning id as e_new \gset
insert into public.vendor_links (organization_id, vendor_id, kind, label, file_name, storage_path, source, email_id) values ('00000000-0000-0000-0000-000000000001', :'v', 'invoice', 'Old', 'old.pdf', 'x/old214.pdf', 'email', :'e_old');
insert into public.vendor_links (organization_id, vendor_id, kind, label, file_name, storage_path, source, email_id) values ('00000000-0000-0000-0000-000000000001', :'v', 'invoice', 'New', 'new.pdf', 'x/new214.pdf', 'email', :'e_new');
select not exists (select 1 from public.billcom_forwards where email_id = :'e_old') as old_not_forwarded,
       exists (select 1 from public.billcom_forwards where email_id = :'e_new') as new_forwarded;
-- off and on again later: the date moves on
update public.vendors set billcom_send = false where id = :'v';
update public.vendors set billcom_send_on_at = now() - interval '1 day' where id = :'v';
update public.vendors set billcom_send = true where id = :'v';
select billcom_send_on_at > now() - interval '1 minute' as date_moves_on from public.vendors where id = :'v';
delete from public.billcom_forwards where vendor_id = :'v';
delete from public.vendor_links where vendor_id = :'v';
delete from public.emails where thread_id = :'th';
delete from public.email_threads where id = :'th';
delete from public.vendors where id = :'v';
