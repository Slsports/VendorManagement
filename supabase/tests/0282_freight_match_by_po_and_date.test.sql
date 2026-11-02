\set ON_ERROR_STOP on
\pset footer off
\echo '>>> 0282: dates in POs; a printed PO confirms the order; otherwise the order placed closest before the ship date'
reset role;
select set_config('request.jwt.claims', '', false) is not null as service;
select public.po_date('PARICON1-19-26') = date '2026-01-19' as dashes, public.po_date('2/4/26 hikers') = date '2026-02-04' as slashes,
       public.po_date('DAISY020326') = date '2026-02-03' as six_digits, public.po_date('BECKER2926') is null as ambiguous_none, public.po_date('6726026') is null as number_none, public.po_date('FRT0282-1-19-26') = date '2026-01-19' as later_match;

insert into public.vendors (organization_id, name) values ('00000000-0000-0000-0000-000000000001', 'Freight 0282 Vendor') returning id as v \gset
insert into public.carriers (organization_id, name, role) values ('00000000-0000-0000-0000-000000000001', 'Carrier 0282', 'billing') returning id as c \gset
insert into public.orders (organization_id, vendor_id, po_number, order_date, status) values
  ('00000000-0000-0000-0000-000000000001', :'v', 'FRT0282-11-20-25', null, 'entered'),
  ('00000000-0000-0000-0000-000000000001', :'v', 'FRT0282-1-19-26', null, 'entered'),
  ('00000000-0000-0000-0000-000000000001', :'v', 'FRT0282-LATER', date '2026-09-01', 'entered'),
  ('00000000-0000-0000-0000-000000000001', :'v', 'FRT0282-CANCEL', date '2026-01-25', 'cancelled');
select id as o_nov from public.orders where po_number = 'FRT0282-11-20-25' \gset
select id as o_jan from public.orders where po_number = 'FRT0282-1-19-26' \gset

insert into public.freight_bills (organization_id, carrier_id, invoice_number, status) values ('00000000-0000-0000-0000-000000000001', :'c', 'INV0282-A', 'reading') returning id as b1 \gset
insert into public.freight_bill_lines (organization_id, bill_id, shipper_name, ship_date, amount, suggested_vendor_id, po_refs) values
  ('00000000-0000-0000-0000-000000000001', :'b1', 'FREIGHT 0282', date '2026-01-30', 100, :'v', array['DELIVERY APPOINTMENT', 'FRT0282 1-19-26']);
select count(*) = 1 as loaded from (select public.freight_bill_loaded(:'b1')) x;
select l.order_id = :'o_jan' as printed_po_wins, l.confirmed as confirmed, (select status from public.freight_bills where id = :'b1') = 'done' as bill_done
  from public.freight_bill_lines l where l.bill_id = :'b1';

\echo '>>> no PO printed: the order placed closest before the ship date, not the newest one, never a cancelled one; not confirmed'
insert into public.freight_bills (organization_id, carrier_id, invoice_number, status) values ('00000000-0000-0000-0000-000000000001', :'c', 'INV0282-B', 'reading') returning id as b2 \gset
insert into public.freight_bill_lines (organization_id, bill_id, shipper_name, ship_date, amount, suggested_vendor_id) values
  ('00000000-0000-0000-0000-000000000001', :'b2', 'FREIGHT 0282', date '2026-01-30', 50, :'v'),
  ('00000000-0000-0000-0000-000000000001', :'b2', 'FREIGHT 0282', date '2025-12-01', 60, :'v'),
  ('00000000-0000-0000-0000-000000000001', :'b2', 'FREIGHT 0282', date '2023-10-26', 70, :'v');
select count(*) = 1 as loaded from (select public.freight_bill_loaded(:'b2')) x;
select (select order_id from public.freight_bill_lines where bill_id = :'b2' and amount = 50) = :'o_jan' as jan_ship_jan_order,
       (select order_id from public.freight_bill_lines where bill_id = :'b2' and amount = 60) = :'o_nov' as dec_ship_nov_order,
       (select order_id is null from public.freight_bill_lines where bill_id = :'b2' and amount = 70) as old_ship_no_order,
       (select bool_and(not confirmed) from public.freight_bill_lines where bill_id = :'b2') as only_suggested,
       (select status from public.freight_bills where id = :'b2') = 'to_match' as bill_to_match;

delete from public.freight_bills where id in (:'b1', :'b2');
delete from public.orders where vendor_id = :'v';
delete from public.carriers where id = :'c';
delete from public.vendors where id = :'v';
