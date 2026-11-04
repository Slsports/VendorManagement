\set ON_ERROR_STOP on
\pset footer off
\echo '>>> 0308: an old reply filed from history makes no price list task'
reset role;
select set_config('request.jwt.claims', '', false) is not null as service;
insert into public.vendors (organization_id, name) values ('00000000-0000-0000-0000-000000000001', 'PL308 OLD') returning id as v \gset
insert into public.email_threads (organization_id, gmail_thread_id) values ('00000000-0000-0000-0000-000000000001', 'pl308') returning id as th \gset
insert into public.emails (organization_id, thread_id, gmail_id, direction, from_email, to_emails, subject, body_text, received_at, vendor_id)
values ('00000000-0000-0000-0000-000000000001', :'th', 'pl308-1', 'out', 'orders@shaverlakesports.com', array['rep@pl308.example'], 'Price list please', 'Thanks, Dana', now() - interval '90 days', :'v');
insert into public.emails (organization_id, thread_id, gmail_id, direction, from_email, subject, body_text, received_at, vendor_id)
values ('00000000-0000-0000-0000-000000000001', :'th', 'pl308-2', 'in', 'rep@pl308.example', 'Re: Price list please', 'Attached', now() - interval '80 days', :'v') returning id as e \gset
insert into public.vendor_links (organization_id, vendor_id, kind, label, storage_path, file_name, email_id)
values ('00000000-0000-0000-0000-000000000001', :'v', 'price_list', 'old list', 'x/pl308.pdf', 'old.pdf', :'e');
select not exists (select 1 from public.tasks where auto_key = 'pricelist:' || :'e') as no_task_for_old_reply;
delete from public.vendor_links where vendor_id = :'v';
delete from public.emails where gmail_id like 'pl308-%';
delete from public.email_threads where id = :'th';
delete from public.vendors where id = :'v';
