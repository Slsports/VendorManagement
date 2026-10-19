\set ON_ERROR_STOP on
\pset footer off
\echo '>>> Bill.com: the vendor switch queues a forward, bills make pay-by tasks that close when paid, waiting list'
reset role;
select set_config('request.jwt.claims', '', false) is not null as service;
insert into public.vendors (organization_id, name, billcom_send) values ('00000000-0000-0000-0000-000000000001', 'Billcom Test Co', true) returning id as v \gset
insert into public.vendors (organization_id, name, billcom_send) values ('00000000-0000-0000-0000-000000000001', 'No Billcom Co', false) returning id as v2 \gset
insert into public.email_threads (organization_id, gmail_thread_id) values ('00000000-0000-0000-0000-000000000001', 't-billcom-1') returning id as th \gset
insert into public.emails (organization_id, gmail_id, thread_id, direction, from_email, subject, received_at) values ('00000000-0000-0000-0000-000000000001', 'g-billcom-1', :'th', 'in', 'ar@billcomtest.com', 'Invoice 4411', now()) returning id as e1 \gset
insert into public.emails (organization_id, gmail_id, thread_id, direction, from_email, subject, received_at) values ('00000000-0000-0000-0000-000000000001', 'g-billcom-2', :'th', 'in', 'ar@nobillcom.com', 'Invoice 9', now()) returning id as e2 \gset
-- an invoice from email for the switched-on vendor: one forward queued; a second invoice in the same email adds none
insert into public.vendor_links (organization_id, vendor_id, kind, label, file_name, storage_path, source, email_id, doc_number, doc_total) values ('00000000-0000-0000-0000-000000000001', :'v', 'invoice', 'Invoice 4411', 'inv4411.pdf', 'x/inv4411.pdf', 'email', :'e1', 'INV-4411', 250.00) returning id as l1 \gset
insert into public.vendor_links (organization_id, vendor_id, kind, label, file_name, storage_path, source, email_id) values ('00000000-0000-0000-0000-000000000001', :'v', 'invoice', 'Invoice 4412', 'inv4412.pdf', 'x/inv4412.pdf', 'email', :'e1');
select count(*) as queued, min(status) as status from public.billcom_forwards where email_id = :'e1';
-- switched off: nothing
insert into public.vendor_links (organization_id, vendor_id, kind, label, file_name, storage_path, source, email_id) values ('00000000-0000-0000-0000-000000000001', :'v2', 'invoice', 'Invoice 9', 'inv9.pdf', 'x/inv9.pdf', 'email', :'e2');
select count(*) as none_for_off from public.billcom_forwards where email_id = :'e2';
-- an upload by hand (not from email): nothing
insert into public.vendor_links (organization_id, vendor_id, kind, label, file_name, storage_path, source) values ('00000000-0000-0000-0000-000000000001', :'v', 'invoice', 'Hand', 'hand.pdf', 'x/hand.pdf', 'manual');
select count(*) as forwards_total from public.billcom_forwards where organization_id = '00000000-0000-0000-0000-000000000001' and vendor_id in (:'v', :'v2');
-- bills: one due in 3 days makes a task; one due in 30 days does not; paid closes it
insert into public.billcom_bills (organization_id, bill_id, vendor_name, invoice_number, due_date, amount, payment_status) values
  ('00000000-0000-0000-0000-000000000001', '00nTEST1', 'Billcom Test Co', 'INV-4411', current_date + 3, 250.00, 'UNPAID'),
  ('00000000-0000-0000-0000-000000000001', '00nTEST2', 'Billcom Test Co', 'INV-5000', current_date + 30, 99.00, 'UNPAID');
select public.billcom_bill_tasks('00000000-0000-0000-0000-000000000001') as tasks_made;
select title, due_date = current_date + 3 as due_in_3, done_at is null as open from public.tasks where auto_key = 'billcom:00nTEST1';
select count(*) as far_off_none from public.tasks where auto_key = 'billcom:00nTEST2';
update public.billcom_bills set payment_status = 'PAID' where bill_id = '00nTEST1';
select public.billcom_bill_tasks('00000000-0000-0000-0000-000000000001') as tasks_made_after;
select done_at is not null as closed, done_note from public.tasks where auto_key = 'billcom:00nTEST1';
-- waiting list: a sent forward whose invoice number is a bill is not waiting; one without is
update public.billcom_forwards set status = 'sent', sent_at = now() - interval '1 hour' where email_id = :'e1';
set role authenticated;
select set_config('request.jwt.claims', '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}', false) is not null as admin_in;
select count(*) as waiting_matched_by_number from public.billcom_waiting('00000000-0000-0000-0000-000000000001') where email_id = :'e1';
reset role;
select set_config('request.jwt.claims', '', false) is not null as service;
update public.billcom_bills set invoice_number = 'OTHER', amount = 1.00 where bill_id = '00nTEST1';
set role authenticated;
select set_config('request.jwt.claims', '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}', false) is not null as admin_in;
select count(*) as waiting_now, min(vendor_name) as vendor from public.billcom_waiting('00000000-0000-0000-0000-000000000001') where email_id = :'e1';
-- "I paid it" on a Bill.com task
reset role;
select set_config('request.jwt.claims', '', false) is not null as service;
insert into public.billcom_bills (organization_id, bill_id, vendor_name, due_date, amount, payment_status) values ('00000000-0000-0000-0000-000000000001', '00nTEST3', 'Billcom Test Co', current_date + 1, 10.00, 'UNPAID');
select public.billcom_bill_tasks('00000000-0000-0000-0000-000000000001') > 0 as made;
set role authenticated;
select set_config('request.jwt.claims', '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}', false) is not null as admin_in;
select public.task_mark_paid((select id from public.tasks where auto_key = 'billcom:00nTEST3')) is null as marked;
select done_note from public.tasks where auto_key = 'billcom:00nTEST3';
-- clean up
reset role;
select set_config('request.jwt.claims', '', false) is not null as service;
delete from public.tasks where auto_key like 'billcom:00nTEST%';
delete from public.billcom_bills where bill_id like '00nTEST%';
delete from public.billcom_forwards where vendor_id in (:'v', :'v2');
delete from public.vendor_links where vendor_id in (:'v', :'v2');
delete from public.emails where thread_id = :'th';
delete from public.email_threads where id = :'th';
delete from public.vendors where id in (:'v', :'v2');
