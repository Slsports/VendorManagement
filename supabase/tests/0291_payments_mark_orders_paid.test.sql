\set ON_ERROR_STOP on
\pset footer off
\echo '>>> 0291: a paid order leaves Payments due'
reset role;
select set_config('request.jwt.claims', '', false) is not null as service;
insert into public.vendors (organization_id, name) values ('00000000-0000-0000-0000-000000000001', 'PD291') returning id as v \gset

\echo '>>> a paid date on an Entered order moves it to Paid; a Received one stays'
insert into public.orders (organization_id, vendor_id, po_number, status, billing_route) values ('00000000-0000-0000-0000-000000000001', :'v', 'PD291-A', 'entered', 'worldwide') returning id as oa \gset
insert into public.orders (organization_id, vendor_id, po_number, status, billing_route) values ('00000000-0000-0000-0000-000000000001', :'v', 'PD291-R', 'received', 'worldwide') returning id as orr \gset
update public.orders set paid_date = date '2026-10-01' where id in (:'oa', :'orr');
select (select status from public.orders where id = :'oa') = 'paid' as entered_to_paid,
       (select status from public.orders where id = :'orr') = 'received' as received_stays;
\echo '>>> a person can set it back; VMS does not force it again'
update public.orders set status = 'entered' where id = :'oa';
update public.orders set notes = 'x' where id = :'oa';
select status = 'entered' as stays_as_set from public.orders where id = :'oa';

\echo '>>> Bill.com: a PAID bill with our PO pays the order; an UNPAID one does not; WWD orders are left to WWD'
insert into public.orders (organization_id, vendor_id, po_number, status, billing_route) values ('00000000-0000-0000-0000-000000000001', :'v', 'PD291-B1', 'entered', 'direct') returning id as ob1 \gset
insert into public.orders (organization_id, vendor_id, po_number, status, billing_route) values ('00000000-0000-0000-0000-000000000001', :'v', 'PD291-B2', 'entered', 'direct') returning id as ob2 \gset
insert into public.orders (organization_id, vendor_id, po_number, status, billing_route) values ('00000000-0000-0000-0000-000000000001', :'v', 'PD291-W', 'entered', 'worldwide') returning id as ow \gset
insert into public.orders (organization_id, vendor_id, po_number, status, billing_route) values ('00000000-0000-0000-0000-000000000001', :'v', 'PD291-I', 'ready_to_pay', 'direct') returning id as oi \gset
insert into public.billcom_bills (organization_id, bill_id, vendor_name, invoice_number, payment_status, raw) values
  ('00000000-0000-0000-0000-000000000001', 'pd291-1', 'PD Vendor', 'INV-77001', 'PAID', '{"purchaseOrderNumber":"PD291 B1"}'),
  ('00000000-0000-0000-0000-000000000001', 'pd291-2', 'PD Vendor', 'INV-77002', 'UNPAID', '{"purchaseOrderNumber":"PD291-B2"}'),
  ('00000000-0000-0000-0000-000000000001', 'pd291-3', 'PD Vendor', 'INV-77003', 'PAID', '{"purchaseOrderNumber":"PD291-W"}'),
  ('00000000-0000-0000-0000-000000000001', 'pd291-4', 'PD Vendor', 'INV-77004', 'PAID', '{}');
\echo '>>> and by the invoice paper on the order (same number, same vendor)'
insert into public.vendor_links (organization_id, vendor_id, kind, label, storage_path, file_name, order_id, doc_number)
values ('00000000-0000-0000-0000-000000000001', :'v', 'invoice', 'inv', 'x/pd291.pdf', 'pd291.pdf', :'oi', 'INV 77004') returning id as li \gset
select public.billcom_orders_paid('00000000-0000-0000-0000-000000000001') = 2 as two_paid;
select status = 'paid' and paid_via = 'billcom' and paid_ref = 'INV-77001' and notes like 'Paid in Bill.com (PD Vendor invoice INV-77001)%' as po_match_paid from public.orders where id = :'ob1';
select status = 'paid' and paid_ref = 'INV-77004' as invoice_match_paid from public.orders where id = :'oi';
select (select status from public.orders where id = :'ob2') = 'entered' as unpaid_stays,
       (select status from public.orders where id = :'ow') = 'entered' as wwd_left_alone;
select public.billcom_orders_paid('00000000-0000-0000-0000-000000000001') = 0 as second_run_changes_nothing;

delete from public.order_checks where order_id in (:'oi');
delete from public.vendor_links where id = :'li';
delete from public.billcom_bills where bill_id like 'pd291-%';
delete from public.orders where vendor_id = :'v';
delete from public.vendors where id = :'v';

\echo '>>> 0292: Bill.com payments are kept once, and give the order its paid date'
insert into public.vendors (organization_id, name) values ('00000000-0000-0000-0000-000000000001', 'PD292 Vendor') returning id as v2 \gset
insert into public.orders (organization_id, vendor_id, po_number, status, billing_route) values ('00000000-0000-0000-0000-000000000001', :'v2', 'PD292-P', 'entered', 'direct') returning id as op \gset
insert into public.billcom_bills (organization_id, bill_id, vendor_name, invoice_number, payment_status, raw) values
  ('00000000-0000-0000-0000-000000000001', 'pd292-1', 'PD292 Vendor', 'INV-88001', 'PAID', '{"purchaseOrderNumber":"PD292-P"}');
select public.billcom_payments_save('00000000-0000-0000-0000-000000000001',
  '[{"payment_id":"pay292","bill_id":"pd292-1","payee":"PD292 Vendor","process_date":"2026-10-20","status":"PAID","amount":"125.50","confirmation":"C292"}]') = 1 as saved_once;
select public.billcom_payments_save('00000000-0000-0000-0000-000000000001',
  '[{"payment_id":"pay292","bill_id":"pd292-1","payee":"PD292 Vendor","process_date":"2026-10-20","status":"PAID","amount":"125.50","confirmation":"C292"}]') = 0 as not_twice;
select vendor_id = :'v2' and invoice_number = 'INV-88001' as tied_to_vendor_and_invoice from public.vendor_payments where billcom_payment_id = 'pay292';
select public.billcom_orders_paid('00000000-0000-0000-0000-000000000001') = 1 as paid_now;
select status = 'paid' and paid_date = date '2026-10-20' and paid_ref = 'C292' and notes like 'Paid in Bill.com Oct 20, 2026 (PD292 Vendor invoice INV-88001, confirmation C292)%' as with_date
  from public.orders where id = :'op';
select order_id = :'op' as payment_points_at_order from public.vendor_payments where billcom_payment_id = 'pay292';
delete from public.vendor_payments where billcom_payment_id = 'pay292';
delete from public.billcom_bills where bill_id = 'pd292-1';
delete from public.orders where vendor_id = :'v2';
delete from public.vendors where id = :'v2';
