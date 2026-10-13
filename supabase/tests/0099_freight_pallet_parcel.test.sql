\set ON_ERROR_STOP on
\pset footer off
\echo '>>> Pallet or parcel: read from the quote, shown on the task, switchable'
reset role;
select set_config('request.jwt.claims', '', false) is not null as service;
select public.freight_ships_by('{"details":{"pallets":[{"count":2}]}}') as pallet,
       public.freight_ships_by('{"details":{"cartons":[{"count":3}],"pallets":[]}}') as parcel,
       public.freight_ships_by('{"ships_by":"pallet","details":{"cartons":[{"count":3}]}}') as said_pallet,
       public.freight_ships_by('{"details":{}}') is null as unknown;
update public.profiles set job_title = 'Receiving & Logistics' where id = '33333333-3333-3333-3333-333333333333';
insert into public.vendors (organization_id, name) values ('00000000-0000-0000-0000-000000000001', 'Pallet Test Vendor') returning id as v \gset
insert into public.orders (organization_id, vendor_id, status, po_number, order_date, source) values ('00000000-0000-0000-0000-000000000001', :'v', 'confirmed', 'PP555', current_date, 'email') returning id as o \gset
insert into public.email_threads (organization_id, gmail_thread_id) values ('00000000-0000-0000-0000-000000000001', 'pp-t1') returning id as t \gset
insert into public.emails (organization_id, thread_id, gmail_id, direction, from_email, subject, body_text, received_at, vendor_id)
values ('00000000-0000-0000-0000-000000000001', :'t', 'pp-1', 'in', 'ship@pallet.example', 'Freight quote', '2 pallets', timestamptz '2026-10-16 10:00 America/Los_Angeles', :'v') returning id as e \gset
select public.freight_quote_apply(:'e', true, '{"cost":"310","details":{"pallets":[{"count":2,"weight":800}]}}', :'v', :'o', 'po') as q \gset
select q.ships_by, t.title from public.freight_quotes q join public.tasks t on t.id = q.task_id where q.id = :'q';
\echo '>>> Trevor switches it to parcel'
set role authenticated;
select set_config('request.jwt.claims', '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}', false) is not null as signed_in;
select public.freight_quote_action(:'q', 'parcel');
reset role;
select set_config('request.jwt.claims', '', false) is not null as service;
select q.ships_by, t.title from public.freight_quotes q join public.tasks t on t.id = q.task_id where q.id = :'q';
delete from public.tasks where auto_key = 'freight_quote:' || :'q';
delete from public.freight_quotes where id = :'q';
delete from public.emails where gmail_id like 'pp-%';
delete from public.email_threads where id = :'t';
delete from public.ls_pos where order_id = :'o';
delete from public.orders where id = :'o';
delete from public.vendors where id = :'v';
