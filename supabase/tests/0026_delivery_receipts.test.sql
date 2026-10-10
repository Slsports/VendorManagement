\set ON_ERROR_STOP on
\pset footer off
\echo '>>> po_key: "PO# 60851" and "60851" are the same PO'
select public.po_key('PO# 60851') as a, public.po_key(' 60851 ') as b, public.po_key('P.O. no. AB-12') as c, public.po_key('') is null as empty;

\echo '>>> a receipt whose PO matches one order: filed to that vendor, PDF in its files, order received date set'
reset role;
select set_config('request.jwt.claims', '', false) is not null as as_service;
insert into public.carriers (organization_id, name, mode, email_domains, owner_id) values ('00000000-0000-0000-0000-000000000001', 'Receipt LTL', 'ltl', '{rcpt.example}', '33333333-3333-3333-3333-333333333333') returning id as rc \gset
insert into public.email_senders (organization_id, sender_key, is_domain) values ('00000000-0000-0000-0000-000000000001', 'rcpt.example', true) returning id as rs \gset
insert into public.vendors (organization_id, name) values ('00000000-0000-0000-0000-000000000001', 'Receipt Toys') returning id as rv \gset
insert into public.vendors (organization_id, name) values ('00000000-0000-0000-0000-000000000001', 'Receipt Other') returning id as rv2 \gset
insert into public.orders (organization_id, vendor_id, po_number) values ('00000000-0000-0000-0000-000000000001', :'rv', '60851') returning id as ro \gset
insert into public.email_threads (organization_id, gmail_thread_id) values ('00000000-0000-0000-0000-000000000001', 'rct1') returning id as rt \gset
insert into public.emails (organization_id, gmail_id, thread_id, direction, from_email, subject, received_at, sender_id, has_attachments)
values ('00000000-0000-0000-0000-000000000001', 'rcm1', :'rt', 'in', 'deliveryreceipt@rcpt.example', 'Delivery Receipt for 518-563231', now(), :'rs', true) returning id as re \gset
insert into public.email_attachments (organization_id, email_id, file_name, mime_type, storage_path)
values ('00000000-0000-0000-0000-000000000001', :'re', '518-563231.pdf', 'application/pdf', 'org/freight/x-518-563231.pdf');
insert into public.delivery_receipts (organization_id, carrier_id, email_id, pro_number, shipper_name, po_numbers, delivered_on, signed_by, storage_path, file_name)
values ('00000000-0000-0000-0000-000000000001', :'rc', :'re', '518-563231', 'ROYAL DELUXE ACCESSORIES LLC', '{"PO# 60851",10000432231038}', '2026-09-14', 'Trevor Jenkins', 'org/freight/x-518-563231.pdf', '518-563231.pdf') returning id as rd \gset
select public.delivery_receipt_loaded(:'rd') as result;
select status, vendor_id = :'rv' as to_vendor, order_id = :'ro' as to_order from public.delivery_receipts where id = :'rd';
select vendor_id = :'rv' as email_filed, match_how, order_id = :'ro' as email_order from public.emails where id = :'re';
select kind, label, notes, order_id = :'ro' as on_order from public.vendor_links where email_id = :'re';
select date_received from public.orders where id = :'ro';
select vendor_link_id is not null as attachment_linked from public.email_attachments where email_id = :'re';

\echo '>>> a receipt nobody can match goes to the review queue for the carrier owner; filing it from there works'
insert into public.email_threads (organization_id, gmail_thread_id) values ('00000000-0000-0000-0000-000000000001', 'rct2') returning id as rt2 \gset
insert into public.emails (organization_id, gmail_id, thread_id, direction, from_email, subject, received_at, sender_id)
values ('00000000-0000-0000-0000-000000000001', 'rcm2', :'rt2', 'in', 'deliveryreceipt@rcpt.example', 'Delivery Receipt for 454-400273', now(), :'rs') returning id as re2 \gset
insert into public.delivery_receipts (organization_id, carrier_id, email_id, pro_number, shipper_name, delivered_on, storage_path, file_name)
values ('00000000-0000-0000-0000-000000000001', :'rc', :'re2', '454-400273', 'Unknown Shipper Inc', '2026-08-17', 'org/freight/y.pdf', 'y.pdf') returning id as rd2 \gset
select public.delivery_receipt_loaded(:'rd2') as result;
select r.kind, r.title, r.assigned_to = '33333333-3333-3333-3333-333333333333'::uuid as to_owner, r.details->>'shipper_name' as shipper
  from public.review_items r join public.delivery_receipts d on d.review_item_id = r.id where d.id = :'rd2';
set role authenticated;
select set_config('request.jwt.claims', '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}', false);
select public.file_delivery_receipt(:'rd2', :'rv2');
select status, vendor_id = :'rv2' as to_vendor from public.delivery_receipts where id = :'rd2';
select r.status from public.review_items r join public.delivery_receipts d on d.review_item_id = r.id where d.id = :'rd2';
\echo '>>> a viewer cannot file a receipt (expect 1 error)'
\set ON_ERROR_STOP off
select set_config('request.jwt.claims', '{"sub":"44444444-4444-4444-4444-444444444444","role":"authenticated"}', false);
select public.file_delivery_receipt(:'rd2', :'rv');
\set ON_ERROR_STOP on
reset role;
