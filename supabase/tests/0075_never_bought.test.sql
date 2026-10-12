\set ON_ERROR_STOP on
\pset footer off
\echo '>>> Claude files a sender to a vendor; undo puts it back on "Who is this?"'
reset role;
insert into public.vendors (organization_id, name) values ('00000000-0000-0000-0000-000000000001', 'NB Test Vendor') returning id as nv \gset
insert into public.email_senders (organization_id, sender_key, is_domain) values ('00000000-0000-0000-0000-000000000001', 'nbfile.example', true) returning id as ns1 \gset
insert into public.email_senders (organization_id, sender_key, is_domain) values ('00000000-0000-0000-0000-000000000001', 'nbnever.example', true) returning id as ns2 \gset
insert into public.email_threads (organization_id, gmail_thread_id) values ('00000000-0000-0000-0000-000000000001', 'nbt1'), ('00000000-0000-0000-0000-000000000001', 'nbt2');
insert into public.emails (organization_id, gmail_id, thread_id, direction, from_email, subject, received_at, sender_id, is_bulk)
select '00000000-0000-0000-0000-000000000001', g, (select id from public.email_threads where gmail_thread_id = t), 'in', f, s, now(), sid::uuid, false
from (values ('nbm1', 'nbt1', 'amy@nbfile.example', 'Fall line', :'ns1'), ('nbm2', 'nbt2', 'sales@nbnever.example', 'Hello store owner', :'ns2')) x(g, t, f, s, sid);
select public.mail_process('00000000-0000-0000-0000-000000000001', (select array_agg(id) from public.emails where gmail_id like 'nbm%'), false) as processed;
select public.mail_apply_sender_sort(:'ns1', 'vendor', :'nv', 'NB File Co', null, null, 'signs as NB Test Vendor') as filed;
select kind, vendor_id = :'nv' as to_vendor from public.email_senders where id = :'ns1';
select vendor_id = :'nv' as thread_filed from public.email_threads where gmail_thread_id = 'nbt1';
set role authenticated;
select set_config('request.jwt.claims', '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}', false);
select public.undo_sender_filing((select id from public.sender_filings where sender_id = :'ns1'));
reset role;
select kind, vendor_id is null as unfiled, sorted_at is not null as sorted from public.email_senders where id = :'ns1';
select vendor_id is null as thread_unfiled from public.email_threads where gmail_thread_id = 'nbt1';
select count(*) as pending_card from public.review_items where entity_id = :'ns1' and status = 'pending';
\echo '>>> never bought from: Marketing, on the list, Promotions; "This is…" files it and keeps the name'
select public.mail_apply_sender_sort(:'ns2', 'never_bought', null, 'Never Co', 'nevertest.example', '559-555-0100', 'sells to stores, no orders') as sorted;
select kind, view_rule from public.email_senders where id = :'ns2';
select view from public.emails where gmail_id = 'nbm2';
set role authenticated;
select set_config('request.jwt.claims', '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}', false);
select company, addresses, website, phone, email_count from public.list_never_bought('00000000-0000-0000-0000-000000000001') where company = 'Never Co';
select public.never_bought_leave(array[:'ns2']::uuid[]);
select checked_at is not null as checked from public.list_never_bought('00000000-0000-0000-0000-000000000001') where company = 'Never Co';
select public.never_bought_is_vendor(array[:'ns2']::uuid[], :'nv') as filed;
reset role;
select aliases from public.vendors where id = :'nv';
select kind, view_rule from public.email_senders where id = :'ns2';
select vendor_id = :'nv' as filed, view from public.emails where gmail_id = 'nbm2';
