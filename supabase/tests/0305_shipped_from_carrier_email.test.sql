\set ON_ERROR_STOP on
\pset footer off
\echo '>>> 0305: a pickup email moves the order to Shipped'
reset role;
select set_config('request.jwt.claims', '', false) is not null as service;
insert into public.vendors (organization_id, name) values ('00000000-0000-0000-0000-000000000001', 'SH305 GLOVES') returning id as v \gset
insert into public.orders (organization_id, vendor_id, po_number, status) values ('00000000-0000-0000-0000-000000000001', :'v', 'SH305A', 'confirmed') returning id as o \gset
insert into public.orders (organization_id, vendor_id, po_number, status) values ('00000000-0000-0000-0000-000000000001', :'v', 'SH305B', 'received') returning id as o2 \gset
insert into public.email_threads (organization_id, gmail_thread_id) values ('00000000-0000-0000-0000-000000000001', 'sh305') returning id as th \gset
insert into public.emails (organization_id, thread_id, gmail_id, direction, from_email, from_name, subject, received_at, vendor_id, order_id)
values ('00000000-0000-0000-0000-000000000001', :'th', 'sh305-1', 'in', 'ltl@broker.example', 'Pinnacle LTL', 'Picked up PO SH305A', timestamptz '2026-11-03 12:00-08', :'v', :'o') returning id as e \gset
update public.emails set ship_carrier = 'XPO', ship_ref = '60116518904', ship_eta = date '2026-11-13' where id = :'e';
select status = 'confirmed' as no_status_yet_no_move from public.orders where id = :'o';
update public.emails set ship_status = 'picked_up' where id = :'e';
select status = 'shipped' and shipped_email_id = :'e'
       and shipment_notes = 'Shipped: picked up by XPO, BOL/tracking 60116518904, expected Nov 13, 2026 (Pinnacle LTL, Nov 03, 2026; VMS moved it to Shipped).' as shipped
  from public.orders where id = :'o';
\echo '>>> a later update does not add a second note; a received order never changes'
update public.emails set ship_status = 'in_transit' where id = :'e';
select (length(shipment_notes) - length(replace(shipment_notes, 'Shipped:', ''))) / 8 = 1 as one_note from public.orders where id = :'o';
insert into public.emails (organization_id, thread_id, gmail_id, direction, from_email, subject, received_at, vendor_id, order_id, ship_status)
values ('00000000-0000-0000-0000-000000000001', :'th', 'sh305-2', 'in', 'track@ups.example', 'Delivered', now(), :'v', :'o2', 'delivered');
select status = 'received' and shipped_email_id is null as received_kept from public.orders where id = :'o2';
\echo '>>> a scheduling-only email (no status) and private mail do nothing'
update public.orders set status = 'confirmed', shipped_email_id = null, shipment_notes = null where id = :'o';
insert into public.mailboxes (organization_id, address, kind, owner_id, label, gmail_box)
select '00000000-0000-0000-0000-000000000001', 'sh305@private.example', 'personal', (select id from public.profiles where organization_id = '00000000-0000-0000-0000-000000000001' limit 1), 'SH305', 'sh305@private.example'
returning id as mb \gset
insert into public.emails (organization_id, thread_id, gmail_id, direction, from_email, subject, received_at, vendor_id, order_id, ship_status, mailbox_id)
values ('00000000-0000-0000-0000-000000000001', :'th', 'sh305-3', 'in', 'ltl@broker.example', 'Picked up', now(), :'v', :'o', 'picked_up', :'mb');
select status = 'confirmed' as private_mail_no_change from public.orders where id = :'o';

delete from public.emails where gmail_id like 'sh305-%';
delete from public.mailboxes where id = :'mb';
delete from public.email_threads where id = :'th';
delete from public.orders where vendor_id = :'v';
delete from public.vendors where id = :'v';
