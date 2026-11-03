\set ON_ERROR_STOP on
\pset footer off
\echo '>>> 0295: WWD weekly upload: Monday task, late note, closed by an upload, waiting Edenred files read again, add a WWD name as a vendor'
reset role;
select set_config('request.jwt.claims', '', false) is not null as service;
select id as admin_id from public.profiles where organization_id = '00000000-0000-0000-0000-000000000001' and role = 'admin' and is_active order by created_at limit 1 \gset
select id as doer from public.profiles where organization_id = '00000000-0000-0000-0000-000000000001' and is_active and id <> :'admin_id' order by created_at limit 1 \gset
update public.organizations set wwd_upload_by = :'doer' where id = '00000000-0000-0000-0000-000000000001';
delete from public.wwd_uploads where organization_id = '00000000-0000-0000-0000-000000000001';
delete from public.tasks where auto_key like 'wwdweekly%';
select public.wwd_weekly_tasks() >= 1 as made;
select assigned_to = :'doer' and title = 'WWD weekly upload' and due_date = public.wwd_week_start() as weekly_task
  from public.tasks where auto_key = 'wwdweekly:' || public.wwd_week_start();
select public.wwd_weekly_tasks() >= 0 as again;
select count(*) = 1 as only_one from public.tasks where auto_key = 'wwdweekly:' || public.wwd_week_start();

\echo '>>> an Edenred file waiting on its WWD invoice is queued again by the upload'
insert into public.email_threads (organization_id, gmail_thread_id) values ('00000000-0000-0000-0000-000000000001', 'wk295') returning id as th \gset
insert into public.emails (organization_id, thread_id, gmail_id, direction, from_email, subject, received_at, has_attachments, paper_scanned_at)
values ('00000000-0000-0000-0000-000000000001', :'th', 'wk295-1', 'in', 'noreply@edenredpayinvoice.com', 'Edenred Invoices', now(), true, now()) returning id as e \gset
insert into public.email_attachments (organization_id, email_id, gmail_attachment_id, file_name, mime_type, accounting_skip)
values ('00000000-0000-0000-0000-000000000001', :'e', 'att295', '5529500.pdf', 'application/pdf', 'Edenred: no WWD invoice found') returning id as att \gset

\echo '>>> a WWD name that is on the WWD portal list'
insert into public.wwd_portal_vendors (organization_id, number, name, read_at, data) values ('00000000-0000-0000-0000-000000000001', '92950', 'Portal 295 Co', now(),
  '{"name": "Portal 295 Co", "address": {"city": "Kent", "state": "WA", "phone": "253-000-0295"}, "standard": {"minimum_order": "$295"}}') returning id as pv \gset
insert into public.wwd_invoices (organization_id, seq, kind, wwd_vendor_name, amount) values ('00000000-0000-0000-0000-000000000001', '9295001', 'invoice', 'PORTAL 295 CO', 29.50) returning id as wi \gset

select set_config('request.jwt.claims', json_build_object('sub', :'doer', 'role', 'authenticated')::text, false) is not null as as_doer;
select public.wwd_upload_done(array['history', 'edenred_lines'], array['a.xls'], '{}'::jsonb) as res \gset
select public.wwd_names_on_portal(array['PORTAL 295 CO', 'NOT ON PORTAL']) = array['PORTAL 295 CO'] as on_portal;
select public.wwd_name_add_vendor('PORTAL 295 CO') as newv \gset
reset role;
select set_config('request.jwt.claims', '', false) is not null as service2;
select (:'res'::jsonb->>'files_to_read')::int >= 1 and (:'res'::jsonb->>'names_on_portal')::int >= 1 as counts;
select accounting_skip is null as file_queued from public.email_attachments where id = :'att';
select paper_scanned_at is null as email_queued from public.emails where id = :'e';
select done_at is not null and done_note like 'Closed by VMS: the WWD weekly upload was done%' as weekly_closed from public.tasks where auto_key = 'wwdweekly:' || public.wwd_week_start();
select (select vendor_id from public.wwd_invoices where id = :'wi') = :'newv' and (select vendor_id from public.wwd_portal_vendors where id = :'pv') = :'newv'
       and (select city from public.vendors where id = :'newv') = 'Kent' as vendor_added;
select public.wwd_weekly_tasks() >= 0 as after_upload;
select count(*) = 0 as no_late_note from public.tasks where auto_key = 'wwdweekly_late:' || public.wwd_week_start() and done_at is null;

delete from public.tasks where auto_key like 'wwdweekly%';
delete from public.wwd_invoices where id = :'wi';
delete from public.wwd_portal_vendors where id = :'pv';
delete from public.vendors where id = :'newv';
delete from public.email_attachments where id = :'att';
delete from public.emails where id = :'e';
delete from public.email_threads where id = :'th';
delete from public.wwd_uploads where organization_id = '00000000-0000-0000-0000-000000000001';
update public.organizations set wwd_upload_by = null where id = '00000000-0000-0000-0000-000000000001';
