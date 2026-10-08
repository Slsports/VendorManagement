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
