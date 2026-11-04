\set ON_ERROR_STOP on
\pset footer off
\echo '>>> 0307: a price list that answers our request makes a task for whoever asked'
reset role;
select set_config('request.jwt.claims', '', false) is not null as service;
insert into public.vendors (organization_id, name) values ('00000000-0000-0000-0000-000000000001', 'PL307 LURES') returning id as v \gset
-- the test login "Jarrett W" (0001 tests) signs our request
select full_name like 'Jarrett%' and is_active and organization_id = '00000000-0000-0000-0000-000000000001' as jarrett_on_file from public.profiles where id = '22222222-2222-2222-2222-222222222222';
insert into public.email_threads (organization_id, gmail_thread_id) values ('00000000-0000-0000-0000-000000000001', 'pl307') returning id as th \gset
insert into public.emails (organization_id, thread_id, gmail_id, direction, from_email, to_emails, subject, body_text, received_at, vendor_id)
values ('00000000-0000-0000-0000-000000000001', :'th', 'pl307-1', 'out', 'orders@shaverlakesports.com', array['rep@pl307.example'], 'Price List & Catalog Please',
        E'Hi Ted,\nCould you send your 2027 price list and catalog?\nThanks,\nJarrett Watson\nShaver Lake Sports', timestamptz '2026-11-01 09:00-07', :'v');
insert into public.emails (organization_id, thread_id, gmail_id, direction, from_email, subject, body_text, received_at, vendor_id)
values ('00000000-0000-0000-0000-000000000001', :'th', 'pl307-2', 'in', 'rep@pl307.example', 'Re: Price List & Catalog Please', 'Attached!', now() - interval '1 hour', :'v')
returning id as e \gset
insert into public.vendor_links (organization_id, vendor_id, kind, label, storage_path, file_name, email_id)
values ('00000000-0000-0000-0000-000000000001', :'v', 'price_list', '2027 price list', 'x/pl307.pdf', '2027 price list.pdf', :'e');
select assigned_to = '22222222-2222-2222-2222-222222222222' as to_who_asked, title = 'PL307 LURES sent the price list you asked for' as titled,
       remind_at is not null as reminded_now, thread_id = :'th' as opens_reply
  from public.tasks where auto_key = 'pricelist:' || :'e';
\echo '>>> a second file on the same reply adds no second task; a price list nobody asked for makes none'
insert into public.vendor_links (organization_id, vendor_id, kind, label, storage_path, file_name, email_id)
values ('00000000-0000-0000-0000-000000000001', :'v', 'catalog', 'catalog', 'x/pl307c.pdf', 'catalog.pdf', :'e');
select count(*) = 1 as one_task from public.tasks where auto_key = 'pricelist:' || :'e';
insert into public.email_threads (organization_id, gmail_thread_id) values ('00000000-0000-0000-0000-000000000001', 'pl307b') returning id as th2 \gset
insert into public.emails (organization_id, thread_id, gmail_id, direction, from_email, subject, body_text, received_at, vendor_id)
values ('00000000-0000-0000-0000-000000000001', :'th2', 'pl307-3', 'in', 'promo@pl307other.example', 'New 2027 line!', 'See our catalog', now(), :'v')
returning id as e2 \gset
insert into public.vendor_links (organization_id, vendor_id, kind, label, storage_path, file_name, email_id)
values ('00000000-0000-0000-0000-000000000001', :'v', 'catalog', 'promo catalog', 'x/pl307p.pdf', 'promo.pdf', :'e2');
select not exists (select 1 from public.tasks where auto_key = 'pricelist:' || :'e2') as unasked_no_task;

delete from public.tasks where auto_key like 'pricelist:%' and vendor_id = :'v';
delete from public.vendor_links where vendor_id = :'v';
delete from public.emails where gmail_id like 'pl307-%';
delete from public.email_threads where id in (:'th', :'th2');
delete from public.vendors where id = :'v';
