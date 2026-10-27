\set ON_ERROR_STOP on
\pset footer off
\echo '>>> 0260: invoices checked against Bill.com: matched by number, Paid, a task when not entered, pay-by wording, Stihl credits apart'
reset role;
select set_config('request.jwt.claims', '', false) is not null as service;
insert into public.vendors (organization_id, name, billcom_check, billcom_pay_where) values ('00000000-0000-0000-0000-000000000001', 'BC260 EJD', true, 'the EJD portal') returning id as v \gset
insert into public.vendor_links (organization_id, vendor_id, kind, label, storage_path, received_at) values
  ('00000000-0000-0000-0000-000000000001', :'v', 'invoice', 'EJD Invoice A', 'x/bc260a.pdf', current_date - 8) returning id as a \gset
insert into public.vendor_links (organization_id, vendor_id, kind, label, storage_path, received_at) values
  ('00000000-0000-0000-0000-000000000001', :'v', 'invoice', 'EJD Invoice B', 'x/bc260b.pdf', current_date - 5) returning id as b \gset
insert into public.vendor_links (organization_id, vendor_id, kind, label, storage_path, received_at) values
  ('00000000-0000-0000-0000-000000000001', :'v', 'credit', 'EJD Credit C', 'x/bc260c.pdf', current_date - 6) returning id as c \gset
-- queued for reading; Claude's readings fill the blanks
select count(*) = 3 as queued from public.billcom_papers_queue('00000000-0000-0000-0000-000000000001', 50) where id in (:'a', :'b', :'c');
select public.billcom_paper_read(:'a', '9689-996921', 'STAN 101826', 1692.42, 'EJD');
select public.billcom_paper_read(:'b', '9690028462', 'STAN101826', 98.40, 'Stihl');
select public.billcom_paper_read(:'c', '9689414689', 'BAAINV100526', -1395.75, 'Stihl');
select doc_number = '9689-996921' and billed_as = 'EJD' and doc_po = 'STAN 101826' as read_filled from public.vendor_links where id = :'a';
-- Bill.com has A (paid) and a Stihl bill by PO + amount for B, unpaid and due soon
insert into public.billcom_bills (organization_id, bill_id, vendor_name, invoice_number, due_date, amount, due_amount, payment_status, archived, raw, synced_at) values
  ('00000000-0000-0000-0000-000000000001', 'bc260-1', 'Emery Jensen Distribution, LLC', '9689996921', current_date + 20, 1692.42, 0, 'PAID', false, '{}', now());
select public.billcom_bill_tasks('00000000-0000-0000-0000-000000000001') >= 0 as ran;
select billcom_bill_id = 'bc260-1' and paid_at = current_date and paid_how = 'Bill.com' as a_in_billcom_paid from public.vendor_links where id = :'a';
select title like 'Enter Stihl invoice 9690028462 $98.40 in Bill.com' and area = 'accounting' as b_enter_task from public.tasks where auto_key = 'billcom_enter:' || :'b';
select count(*) = 0 as no_task_for_a from public.tasks where auto_key = 'billcom_enter:' || :'a';
insert into public.billcom_bills (organization_id, bill_id, vendor_name, invoice_number, due_date, amount, due_amount, payment_status, archived, raw, synced_at) values
  ('00000000-0000-0000-0000-000000000001', 'bc260-2', 'Emery Jensen Distribution, LLC', 'X-1', current_date + 3, 98.40, 98.40, 'UNPAID', false, '{"purchaseOrderNumber": "STAN 101826"}', now());
select public.billcom_bill_tasks('00000000-0000-0000-0000-000000000001') >= 1 as ran_again;
select done_at is not null and closed_how = 'vms' as enter_task_closed from public.tasks where auto_key = 'billcom_enter:' || :'b';
select title = format('Pay Stihl $98.40 by %s on the EJD portal, then mark it paid offline in Bill.com', to_char(current_date + 3, 'FMMM/FMDD/YY'))
   and notes like '%Billed as Stihl%Stihl credits on file%9689414689%' and vendor_id = :'v' as pay_task
  from public.tasks where auto_key = 'billcom:bc260-2';

delete from public.tasks where auto_key in ('billcom:bc260-1', 'billcom:bc260-2', 'billcom_enter:' || :'a', 'billcom_enter:' || :'b');
delete from public.billcom_bills where bill_id in ('bc260-1', 'bc260-2');
delete from public.vendor_links where vendor_id = :'v';
delete from public.vendors where id = :'v';
