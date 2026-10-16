\set ON_ERROR_STOP on
\pset footer off
\echo '>>> An approved artwork conversation stars its proofs and marks its order Artwork approved'
reset role;
select set_config('request.jwt.claims', '', false) is not null as service;
insert into public.vendors (organization_id, name) values ('00000000-0000-0000-0000-000000000001', 'Art Test Tees') returning id as v \gset
insert into public.orders (organization_id, vendor_id, status, source, order_date) values ('00000000-0000-0000-0000-000000000001', :'v', 'open', 'manual', current_date) returning id as o \gset
insert into public.email_threads (organization_id, gmail_thread_id, art_status) values ('00000000-0000-0000-0000-000000000001', 'art-thread-130', 'waiting') returning id as t \gset
insert into public.emails (organization_id, gmail_id, thread_id, direction, received_at, order_id) values ('00000000-0000-0000-0000-000000000001', 'art-130-1', :'t', 'in', now() - interval '1 day', :'o') returning id as e1 \gset
insert into public.emails (organization_id, gmail_id, thread_id, direction, received_at) values ('00000000-0000-0000-0000-000000000001', 'art-130-2', :'t', 'out', now() - interval '1 hour');
insert into public.vendor_links (organization_id, vendor_id, kind, label, url, file_name, source, email_id)
values ('00000000-0000-0000-0000-000000000001', :'v', 'proof', 'Baseball tee proof', 'https://x/p.pdf', 'Proof.pdf', 'email', :'e1') returning id as p \gset
update public.email_threads set art_status = 'approved' where id = :'t';
select kind, approved_at is not null as has_date from public.vendor_links where id = :'p';
select art_approved_at is not null as order_marked from public.orders where id = :'o';
delete from public.vendor_links where id = :'p';
delete from public.emails where thread_id = :'t';
delete from public.email_threads where id = :'t';
delete from public.orders where id = :'o';
delete from public.vendors where id = :'v';
