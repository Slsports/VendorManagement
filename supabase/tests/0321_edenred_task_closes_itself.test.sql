\set ON_ERROR_STOP on
\pset footer off
\echo '>>> An Edenred task closes itself once every file VMS could not place is filed'
reset role;
select set_config('request.jwt.claims', '', false) is not null as claims_cleared;
select id as admin_id from public.profiles where organization_id = '00000000-0000-0000-0000-000000000001' and role = 'admin' and is_active order by created_at limit 1 \gset
insert into public.vendors (organization_id, name) values ('00000000-0000-0000-0000-000000000001', 'Edenred Close Test Vendor') returning id as v \gset
insert into public.email_threads (organization_id, gmail_thread_id, subject) values ('00000000-0000-0000-0000-000000000001', 'ed-t1', 'Edenred Invoices') returning id as t1 \gset
insert into public.emails (organization_id, gmail_id, thread_id, direction, from_email, to_emails, received_at)
  values ('00000000-0000-0000-0000-000000000001', 'ed-e1', :'t1', 'in', 'noreply@edenredpayinvoice.com', array['orders@example.com'], now()) returning id as e1 \gset
insert into public.email_attachments (organization_id, email_id, file_name, mime_type, accounting_skip)
  values ('00000000-0000-0000-0000-000000000001', :'e1', 'a.pdf', 'application/pdf', 'Edenred: no WWD invoice found') returning id as a1 \gset
insert into public.email_attachments (organization_id, email_id, file_name, mime_type, accounting_skip)
  values ('00000000-0000-0000-0000-000000000001', :'e1', 'b.pdf', 'application/pdf', 'Edenred: WWD invoice has no vendor yet') returning id as a2 \gset
insert into public.email_attachments (organization_id, email_id, file_name, mime_type)
  values ('00000000-0000-0000-0000-000000000001', :'e1', 'placed.pdf', 'application/pdf');
insert into public.tasks (organization_id, title, assigned_to, thread_id, auto_key, due_date)
  values ('00000000-0000-0000-0000-000000000001', 'Edenred: 2 invoice files VMS couldn''t place', :'admin_id', :'t1', 'edenred:' || :'e1', current_date) returning id as task \gset
select count(*) = 2 as two_waiting from public.edenred_unplaced_files(:'e1');

-- one filed: still open
insert into public.vendor_links (organization_id, vendor_id, kind, label, file_name, storage_path) values ('00000000-0000-0000-0000-000000000001', :'v', 'invoice', 'Invoice 1', 'a.pdf', 'test/a.pdf') returning id as l1 \gset
update public.email_attachments set vendor_link_id = :'l1' where id = :'a1';
select done_at is null as open_with_one_left from public.tasks where id = :'task';

-- the other made a freight bill: closed by VMS, with a note naming the vendor
insert into public.carriers (organization_id, name) values ('00000000-0000-0000-0000-000000000001', 'Edenred Close Test Freight') returning id as c \gset
insert into public.freight_bills (organization_id, carrier_id, file_name, status, source_attachment_id) values ('00000000-0000-0000-0000-000000000001', :'c', 'b.pdf', 'reading', :'a2');
select done_at is not null and closed_how = 'vms' and done_note like '%Edenred Close Test Vendor%' as closed_by_vms from public.tasks where id = :'task';
select count(*) = 0 as none_waiting from public.edenred_unplaced_files(:'e1');

delete from public.tasks where id = :'task';
delete from public.freight_bills where source_attachment_id = :'a2';
delete from public.email_threads where id = :'t1';
delete from public.vendor_links where id = :'l1';
delete from public.vendors where id = :'v';
delete from public.carriers where id = :'c';
