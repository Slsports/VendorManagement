\set ON_ERROR_STOP on
\pset footer off
\echo '>>> 0284: the vendor''s email (tracking with spaces) and papers prove a freight line''s order'
reset role;
select set_config('request.jwt.claims', '', false) is not null as service;
insert into public.vendors (organization_id, name) values ('00000000-0000-0000-0000-000000000001', 'Freight 0284 Vendor') returning id as v \gset
insert into public.carriers (organization_id, name, role) values ('00000000-0000-0000-0000-000000000001', 'Carrier 0284', 'billing') returning id as c \gset
insert into public.orders (organization_id, vendor_id, po_number, order_date, status) values ('00000000-0000-0000-0000-000000000001', :'v', 'SHOW0284', date '2026-02-03', 'entered') returning id as o1 \gset
insert into public.orders (organization_id, vendor_id, po_number, order_date, status) values ('00000000-0000-0000-0000-000000000001', :'v', 'LATE0284', date '2026-02-20', 'entered') returning id as o2 \gset
insert into public.email_threads (organization_id, gmail_thread_id) values ('00000000-0000-0000-0000-000000000001', 'f0284') returning id as th \gset
insert into public.emails (organization_id, thread_id, gmail_id, direction, from_email, subject, body_text, received_at, vendor_id)
values ('00000000-0000-0000-0000-000000000001', :'th', 'f0284-1', 'in', 'k@vendor0284.example', 'FW: SHAVER LAKE SPORTS',
        'Attached is your invoice. Shipped today UPS tracking # 1z546 070 03 4393 0284.', date '2026-02-25' + time '12:00', :'v') returning id as e \gset
insert into public.vendor_links (organization_id, vendor_id, kind, label, order_id, email_id, doc_number, doc_date, storage_path)
values ('00000000-0000-0000-0000-000000000001', :'v', 'invoice', 'Invoice 169580', :'o1', :'e', '169580', date '2026-02-20', 'test/0284-a.pdf');
insert into public.vendor_links (organization_id, vendor_id, kind, label, order_id, doc_number, doc_date, storage_path)
values ('00000000-0000-0000-0000-000000000001', :'v', 'invoice', 'Invoice 48571-1', :'o2', '485711', date '2026-03-10', 'test/0284-b.pdf');
insert into public.freight_bills (organization_id, carrier_id, invoice_number, status) values ('00000000-0000-0000-0000-000000000001', :'c', 'INV0284', 'reading') returning id as b \gset
insert into public.freight_bill_lines (organization_id, bill_id, shipper_name, ship_date, amount, suggested_vendor_id, tracking, po_refs) values
  ('00000000-0000-0000-0000-000000000001', :'b', 'VENDOR 0284', date '2026-02-25', 38, :'v', array['1Z5460700343930284'], '{}'),
  ('00000000-0000-0000-0000-000000000001', :'b', 'VENDOR 0284', date '2026-03-10', 20, :'v', array['1ZXX99'], array['#48571']);
select count(*) = 1 as loaded from (select public.freight_bill_loaded(:'b')) x;
select (select confirmed and order_id = :'o1' from public.freight_bill_lines where bill_id = :'b' and amount = 38) as spaced_tracking_email_invoice,
       (select confirmed and order_id = :'o2' from public.freight_bill_lines where bill_id = :'b' and amount = 20) as ref_is_their_invoice,
       (select status from public.freight_bills where id = :'b') = 'done' as bill_done;
delete from public.freight_bills where id = :'b';
delete from public.vendor_links where vendor_id = :'v';
delete from public.emails where gmail_id = 'f0284-1';
delete from public.email_threads where id = :'th';
delete from public.orders where vendor_id = :'v';
delete from public.carriers where id = :'c';
delete from public.vendors where id = :'v';
