\set ON_ERROR_STOP on
\pset footer off
\echo '>>> 0293: WWD Payments Due list: WWD dates win, reminders 3 days before the discount date or the due date'
reset role;
select id as admin_id from public.profiles where organization_id = '00000000-0000-0000-0000-000000000001' and role = 'admin' and is_active order by created_at limit 1 \gset
select set_config('request.jwt.claims', json_build_object('sub', :'admin_id', 'role', 'authenticated')::text, false) is not null as as_admin;
insert into public.wwd_invoices (organization_id, seq, kind, wwd_date, wwd_vendor_name, amount, due_date, terms)
values ('00000000-0000-0000-0000-000000000001', '9293001', 'invoice', current_date - 30, 'DUE293 CO', 1000, current_date + 5, 'Net 60 - 60') returning id as w1 \gset
select public.wwd_due_list(jsonb_build_object('rows', jsonb_build_array(
  jsonb_build_object('seq', '9293001', 'kind', 'invoice', 'wwd_date', (current_date - 30)::text, 'vendor_name', 'DUE293 CO', 'amount', 1000, 'due_date', (current_date + 40)::text, 'disc_date', null, 'disc_avail', null),
  jsonb_build_object('seq', '9293002', 'kind', 'invoice', 'wwd_date', (current_date - 2)::text, 'vendor_name', 'DUE293 CO', 'amount', 500, 'due_date', (current_date + 90)::text, 'disc_date', (current_date + 20)::text, 'disc_avail', 25)
))) as res \gset
reset role;
select set_config('request.jwt.claims', '', false) is not null as service;
select (:'res'::jsonb->>'rows')::int = 2 and (:'res'::jsonb->>'added')::int = 1 and (:'res'::jsonb->>'dates_changed')::int = 1 and (:'res'::jsonb->>'with_discount')::int = 1 as counts;
select wwd_due_date = current_date + 40 and due_date = current_date + 40 and paid_date is null and sheet_paid_date is null as wwd_date_wins_not_paid from public.wwd_invoices where id = :'w1';
select title like 'Pay DUE293 CO by % ($1,000.00, WWD 9293001)' and due_date = current_date + 40
       and remind_at = ((current_date + 37) + time '08:00') at time zone 'America/Los_Angeles' as due_reminder_3_days
  from public.tasks where auto_key = 'wwd:' || :'w1' || ':due';
select id as w2 from public.wwd_invoices where seq = '9293002' \gset
select title like 'Pay DUE293 CO by % to take the $25.00 discount (WWD 9293002)' and due_date = current_date + 20
       and remind_at = ((current_date + 17) + time '08:00') at time zone 'America/Los_Angeles' as discount_reminder
  from public.tasks where auto_key = 'wwd:' || :'w2' || ':disc';
\echo '>>> the discount date passes: the due-date reminder takes over, with a note'
update public.wwd_invoices set disc_date = current_date - 1 where id = :'w2';
select public.sync_payment_tasks('00000000-0000-0000-0000-000000000001') >= 1 as resynced;
select done_at is not null and done_note like 'Closed by VMS: the discount date passed%' as disc_closed from public.tasks where auto_key = 'wwd:' || :'w2' || ':disc';
select done_at is null as due_open from public.tasks where auto_key = 'wwd:' || :'w2' || ':due';
\echo '>>> paid on a payment sheet: the reminder closes'
update public.wwd_invoices set sheet_paid_date = current_date where id = :'w2';
select public.sync_payment_tasks('00000000-0000-0000-0000-000000000001') >= 0 as resynced2;
select done_at is not null and done_note = 'Paid' as paid_closed from public.tasks where auto_key = 'wwd:' || :'w2' || ':due';
delete from public.tasks where auto_key like 'wwd:' || :'w1' || '%' or auto_key like 'wwd:' || :'w2' || '%';
delete from public.wwd_invoices where seq in ('9293001', '9293002');
