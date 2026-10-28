\set ON_ERROR_STOP on
\pset footer off
\echo '>>> 0263: a vendor backorder/delay email makes a task for whoever placed the order; carriers and old mail do not'
reset role;
select set_config('request.jwt.claims', '', false) is not null as service;
insert into public.vendors (organization_id, name) values ('00000000-0000-0000-0000-000000000001', 'DL263 SPORTS') returning id as v \gset
insert into public.orders (organization_id, vendor_id, status, order_date, placed_by_id) values ('00000000-0000-0000-0000-000000000001', :'v', 'open', current_date, '33333333-3333-3333-3333-333333333333') returning id as o, po_number as po \gset
insert into public.email_threads (organization_id, gmail_thread_id, subject, last_message_at) values ('00000000-0000-0000-0000-000000000001', 'dl263', 'SO 1', now()) returning id as t \gset
insert into public.emails (organization_id, thread_id, gmail_id, direction, from_email, subject, body_text, received_at, vendor_id, order_id)
values ('00000000-0000-0000-0000-000000000001', :'t', 'dl263-1', 'in', 'maria@dl263.example.com', 'SO 1', 'Backordered items attached', now(), :'v', :'o') returning id as e \gset
update public.emails set ship_status = 'exception', reply_note = 'Vendor reports backorders' where id = :'e';
select assigned_to = '33333333-3333-3333-3333-333333333333' and title like 'DL263 SPORTS: backorders or shipping delays%' and notes like 'Vendor reports backorders%' and remind_at is not null
  as task_for_placer from public.tasks where auto_key = 'shipupd:' || :'e';
-- old mail: nothing
insert into public.emails (organization_id, thread_id, gmail_id, direction, from_email, subject, received_at, vendor_id)
values ('00000000-0000-0000-0000-000000000001', :'t', 'dl263-2', 'in', 'maria@dl263.example.com', 'SO 0', now() - interval '10 days', :'v') returning id as e2 \gset
update public.emails set ship_status = 'exception' where id = :'e2';
select count(*) = 0 as old_mail_no_task from public.tasks where auto_key = 'shipupd:' || :'e2';
delete from public.tasks where auto_key in ('shipupd:' || :'e', 'shipupd:' || :'e2');
delete from public.emails where thread_id = :'t';
delete from public.email_threads where id = :'t';
delete from public.orders where id = :'o';
delete from public.vendors where id = :'v';
