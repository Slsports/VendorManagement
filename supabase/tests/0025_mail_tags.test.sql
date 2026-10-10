\set ON_ERROR_STOP on
\pset footer off
\echo '>>> mail from a service naming three vendors is tagged to each; the conversation shows them; a person adds and removes one'
reset role;
select set_config('request.jwt.claims', '', false) is not null as as_service;
insert into public.vendors (organization_id, name) values ('00000000-0000-0000-0000-000000000001', 'Tag Test Lanard') returning id as tv1 \gset
insert into public.vendors (organization_id, name) values ('00000000-0000-0000-0000-000000000001', 'Tag Test Kid Galaxy') returning id as tv2 \gset
insert into public.vendors (organization_id, name) values ('00000000-0000-0000-0000-000000000001', 'Tag Test Eastman') returning id as tv3 \gset
insert into public.email_senders (organization_id, sender_key, is_domain, kind) values ('00000000-0000-0000-0000-000000000001', 'tagtestbuygroup.com', true, 'platform') returning id as tgs \gset
insert into public.email_threads (organization_id, gmail_thread_id) values ('00000000-0000-0000-0000-000000000001', 'tagt1') returning id as tgt \gset
insert into public.emails (organization_id, gmail_id, thread_id, direction, from_email, subject, received_at, sender_id, mentioned_vendor_ids)
values ('00000000-0000-0000-0000-000000000001', 'tagm1', :'tgt', 'in', 'warehouse@tagtestbuygroup.com', 'merchandise ready to ship', now(), :'tgs', array[:'tv1', :'tv2', :'tv3']::uuid[]) returning id as tge \gset
select count(*) as tags from public.email_vendor_tags where email_id = :'tge';
select cardinality(tagged_vendor_ids) as on_thread from public.email_threads where id = :'tgt';
insert into public.vendors (organization_id, name) values ('00000000-0000-0000-0000-000000000001', 'Tag Test May Cheong') returning id as tv4 \gset
set role authenticated;
select set_config('request.jwt.claims', '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}', false);
select public.tag_email_vendor(:'tge', :'tv4', true);
select public.tag_email_vendor(:'tge', :'tv3', false);
select how, count(*) from public.email_vendor_tags where email_id = :'tge' group by how order by how;
\echo '>>> Marketing goes to Offers & catalogs; Other stays in Needs attention and goes to the admin'
reset role;
insert into public.email_senders (organization_id, sender_key, is_domain) values ('00000000-0000-0000-0000-000000000001', 'adsonly.com', true) returning id as mks \gset
insert into public.email_senders (organization_id, sender_key, is_domain) values ('00000000-0000-0000-0000-000000000001', 'someperson@gmail.com', false) returning id as ots \gset
insert into public.email_threads (organization_id, gmail_thread_id) values ('00000000-0000-0000-0000-000000000001', 'mk1'), ('00000000-0000-0000-0000-000000000001', 'ot1');
insert into public.emails (organization_id, gmail_id, thread_id, direction, from_email, subject, received_at, sender_id)
values ('00000000-0000-0000-0000-000000000001', 'mkm1', (select id from public.email_threads where gmail_thread_id = 'mk1'), 'in', 'news@adsonly.com', 'Big sale', now(), :'mks'),
       ('00000000-0000-0000-0000-000000000001', 'otm1', (select id from public.email_threads where gmail_thread_id = 'ot1'), 'in', 'someperson@gmail.com', 'Question about your store', now(), :'ots');
set role authenticated;
select public.resolve_email_sender(:'mks', 'marketing');
select public.resolve_email_sender(:'ots', 'not_vendor');
reset role;
select gmail_id, view from public.emails where gmail_id in ('mkm1', 'otm1') order by 1;
select gmail_thread_id, owner_id = '11111111-1111-1111-1111-111111111111'::uuid as to_admin from public.email_threads where gmail_thread_id = 'ot1';
\echo '>>> an order moves to its real vendor'
insert into public.orders (organization_id, vendor_id) values ('00000000-0000-0000-0000-000000000001', :'tv1') returning id as mo \gset
set role authenticated;
select public.move_order_vendor(:'mo', :'tv4');
reset role;
select vendor_id = :'tv4' as moved from public.orders where id = :'mo';
\echo '>>> a sender handled email by email: two to a vendor, one Marketing, one Other; the card closes when none are left'
reset role;
insert into public.email_senders (organization_id, sender_key, is_domain) values ('00000000-0000-0000-0000-000000000001', 'mixed@gmail.com', false) returning id as mxs \gset
insert into public.review_items (organization_id, kind, entity_type, entity_id, title) values ('00000000-0000-0000-0000-000000000001', 'email_sender', 'email_sender', :'mxs', 'Mail from mixed@gmail.com') returning id as mxr \gset
update public.email_senders set review_item_id = :'mxr' where id = :'mxs';
insert into public.email_threads (organization_id, gmail_thread_id) values ('00000000-0000-0000-0000-000000000001', 'mx1'), ('00000000-0000-0000-0000-000000000001', 'mx2'), ('00000000-0000-0000-0000-000000000001', 'mx3'), ('00000000-0000-0000-0000-000000000001', 'mx4');
insert into public.emails (organization_id, gmail_id, thread_id, direction, from_email, subject, received_at, sender_id)
select '00000000-0000-0000-0000-000000000001', 'mxm' || n, (select id from public.email_threads where gmail_thread_id = 'mx' || n), 'in', 'mixed@gmail.com', 'Mail ' || n, now(), :'mxs' from generate_series(1, 4) n;
set role authenticated;
select set_config('request.jwt.claims', '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}', false);
select public.review_sender_emails(:'mxs', (select array_agg(id) from public.emails where gmail_id in ('mxm1', 'mxm2')), 'vendor', :'tv1') as filed;
select status from public.review_items where id = :'mxr';
select public.review_sender_emails(:'mxs', (select array_agg(id) from public.emails where gmail_id = 'mxm3'), 'marketing') as marketing;
select public.review_sender_emails(:'mxs', (select array_agg(id) from public.emails where gmail_id = 'mxm4'), 'other') as other;
reset role;
select gmail_id, vendor_id = :'tv1' as to_vendor, disposition, view from public.emails where gmail_id like 'mxm%' order by 1;
select status, (select kind from public.email_senders where id = :'mxs') as sender_still from public.review_items where id = :'mxr';
