\set ON_ERROR_STOP on
\pset footer off
\echo '>>> 0290: a vendor email that cancels the order marks it Cancelled and tells whoever placed it'
reset role;
select set_config('request.jwt.claims', '', false) is not null as service;
select id as admin_id from public.profiles where organization_id = '00000000-0000-0000-0000-000000000001' and role = 'admin' and is_active order by created_at limit 1 \gset
insert into public.vendors (organization_id, name) values ('00000000-0000-0000-0000-000000000001', 'CX290') returning id as v \gset
insert into public.orders (organization_id, vendor_id, po_number, status, placed_by_id) values ('00000000-0000-0000-0000-000000000001', :'v', 'CX290', 'confirmed', :'admin_id') returning id as o \gset
insert into public.orders (organization_id, vendor_id, po_number, status) values ('00000000-0000-0000-0000-000000000001', :'v', 'CX290-IN', 'received') returning id as o2 \gset
insert into public.email_threads (organization_id, gmail_thread_id) values ('00000000-0000-0000-0000-000000000001', 'cx290') returning id as th \gset
insert into public.emails (organization_id, thread_id, gmail_id, direction, from_email, subject, received_at, vendor_id, order_id)
values ('00000000-0000-0000-0000-000000000001', :'th', 'cx290-1', 'in', 'rep@cx290.example', 'Order CX290 cancelled', timestamptz '2026-11-01 10:00-07', :'v', :'o') returning id as e \gset
insert into public.emails (organization_id, thread_id, gmail_id, direction, from_email, subject, received_at, vendor_id, order_id)
values ('00000000-0000-0000-0000-000000000001', :'th', 'cx290-2', 'in', 'rep@cx290.example', 'Order cancelled', timestamptz '2026-11-01 11:00-07', :'v', :'o2') returning id as e2 \gset
select public.order_cancel_from_email(:'e') as cancelled;
select status = 'cancelled' and notes like 'Cancelled per CX290''s email of Nov 01, 2026%' as order_cancelled from public.orders where id = :'o';
select assigned_to = :'admin_id' and title = 'FYI: order CX290 was cancelled' and thread_id = :'th' as fyi_task from public.tasks where auto_key = 'ordercancel:' || :'o';
\echo '>>> an order already received is never changed'
select not public.order_cancel_from_email(:'e2') as refused, (select status from public.orders where id = :'o2') = 'received' as still_received;
\echo '>>> the same email again changes nothing'
select not public.order_cancel_from_email(:'e') as already_cancelled, (select count(*) from public.tasks where auto_key = 'ordercancel:' || :'o') = 1 as one_task;

delete from public.tasks where auto_key in ('ordercancel:' || :'o', 'ordercancel:' || :'o2');
delete from public.emails where thread_id = :'th';
delete from public.email_threads where id = :'th';
delete from public.orders where vendor_id = :'v';
delete from public.vendors where id = :'v';
