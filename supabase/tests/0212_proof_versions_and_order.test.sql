\set ON_ERROR_STOP on
\pset footer off
\echo '>>> Proofs: only the approved version is starred, earlier ones not used; proofs tied to their order'
reset role;
select set_config('request.jwt.claims', '', false) is not null as service;
insert into public.vendors (organization_id, name) values ('00000000-0000-0000-0000-000000000001', 'PV212 COTTON') returning id as v \gset
insert into public.orders (organization_id, vendor_id, status, order_date) values ('00000000-0000-0000-0000-000000000001', :'v', 'open', current_date) returning id as o \gset
insert into public.orders (organization_id, vendor_id, status, order_date) values ('00000000-0000-0000-0000-000000000001', :'v', 'open', current_date) returning id as o2 \gset
insert into public.email_threads (organization_id, gmail_thread_id, vendor_id) values ('00000000-0000-0000-0000-000000000001', 'pv212', :'v') returning id as t \gset
insert into public.emails (organization_id, gmail_id, thread_id, direction, from_email, subject, received_at) values
  ('00000000-0000-0000-0000-000000000001', 'pv212-1', :'t', 'in', 'art@pc.com', 'Proof v1', now() - interval '3 days') returning id as e1 \gset
insert into public.emails (organization_id, gmail_id, thread_id, direction, from_email, subject, received_at) values
  ('00000000-0000-0000-0000-000000000001', 'pv212-2', :'t', 'in', 'art@pc.com', 'Proof v2', now() - interval '2 days') returning id as e2 \gset
-- the confirmation in the v2 email is tied to order o; two open orders, so no guess from "the one open order"
insert into public.vendor_links (organization_id, vendor_id, kind, label, url, email_id, order_id) values ('00000000-0000-0000-0000-000000000001', :'v', 'confirmation', 'SO 1', 'https://example.com/so', :'e2', :'o');
insert into public.vendor_links (organization_id, vendor_id, kind, label, url, email_id, received_at) values ('00000000-0000-0000-0000-000000000001', :'v', 'proof', 'v1', 'https://example.com/v1', :'e1', current_date - 3) returning id as p1 \gset
insert into public.vendor_links (organization_id, vendor_id, kind, label, url, email_id, received_at) values ('00000000-0000-0000-0000-000000000001', :'v', 'proof', 'v2', 'https://example.com/v2', :'e2', current_date - 2) returning id as p2 \gset
select (select order_id from public.vendor_links where id = :'p2') = :'o' and (select order_id from public.vendor_links where id = :'p1') = :'o' as tied_to_order;
-- our OK, then the conversation is approved
insert into public.emails (organization_id, gmail_id, thread_id, direction, from_email, subject, received_at) values
  ('00000000-0000-0000-0000-000000000001', 'pv212-3', :'t', 'out', 'orders@x.com', 'Approved', now() - interval '1 day');
update public.email_threads set art_status = 'approved' where id = :'t';
select kind = 'approved_proof' and superseded_at is null as final_starred from public.vendor_links where id = :'p2';
select kind = 'proof' and superseded_at is not null as earlier_not_used from public.vendor_links where id = :'p1';
select done_note = 'Earlier version, not used' as earlier_task_closed from public.tasks where auto_key = 'proof:' || :'p1';
select art_approved_at is not null as order_art_approved from public.orders where id = :'o';
-- a proof landing in a conversation whose confirmation gets its order later
insert into public.email_threads (organization_id, gmail_thread_id, vendor_id) values ('00000000-0000-0000-0000-000000000001', 'pv212b', :'v') returning id as t2 \gset
insert into public.emails (organization_id, gmail_id, thread_id, direction, from_email, subject, received_at) values
  ('00000000-0000-0000-0000-000000000001', 'pv212-4', :'t2', 'in', 'art@pc.com', 'Proof and order', now()) returning id as e4 \gset
insert into public.vendor_links (organization_id, vendor_id, kind, label, url, email_id, received_at) values ('00000000-0000-0000-0000-000000000001', :'v', 'proof', 'v3', 'https://example.com/v3', :'e4', current_date) returning id as p3 \gset
insert into public.vendor_links (organization_id, vendor_id, kind, label, url, email_id) values ('00000000-0000-0000-0000-000000000001', :'v', 'confirmation', 'SO 2', 'https://example.com/so2', :'e4') returning id as d2 \gset
select order_id is null as not_yet from public.vendor_links where id = :'p3';
insert into public.order_checks (organization_id, vendor_id, document_id, kind, status, email_id) values ('00000000-0000-0000-0000-000000000001', :'v', :'d2', 'confirmation', 'to_review', :'e4') returning id as c \gset
update public.order_checks set order_id = :'o2' where id = :'c';
select order_id = :'o2' as follows_its_confirmation from public.vendor_links where id = :'p3';

delete from public.tasks where auto_key like 'proof:%' and vendor_id = :'v';
delete from public.order_checks where vendor_id = :'v';
delete from public.vendor_links where vendor_id = :'v';
delete from public.emails where gmail_id like 'pv212-%';
delete from public.email_threads where gmail_thread_id like 'pv212%';
delete from public.orders where vendor_id = :'v';
delete from public.vendors where id = :'v';
