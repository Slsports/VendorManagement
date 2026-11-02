\set ON_ERROR_STOP on
\pset footer off
\echo '>>> 0283: packages of a confirmed shipment follow it; "INV.# 32962" matches order 32962'
reset role;
select set_config('request.jwt.claims', '', false) is not null as service;
select public.freight_ref_key('INV.# 32962') = '32962' as inv_label, public.freight_ref_key('PO: PARICON1-19-26') = 'paricon11926' as po_label,
       public.freight_ref_key('PARICON1-19-26') = 'paricon11926' as plain;
insert into public.vendors (organization_id, name) values ('00000000-0000-0000-0000-000000000001', 'Freight 0283 Vendor') returning id as v \gset
insert into public.carriers (organization_id, name, role) values ('00000000-0000-0000-0000-000000000001', 'Carrier 0283', 'billing') returning id as c \gset
insert into public.orders (organization_id, vendor_id, po_number, order_date, status) values ('00000000-0000-0000-0000-000000000001', :'v', 'F0283A', date '2026-01-01', 'entered') returning id as o \gset
insert into public.freight_bills (organization_id, carrier_id, invoice_number, status) values ('00000000-0000-0000-0000-000000000001', :'c', 'INV0283', 'reading') returning id as b \gset
insert into public.freight_bill_lines (organization_id, bill_id, shipper_name, ship_date, amount, suggested_vendor_id, po_refs) values
  ('00000000-0000-0000-0000-000000000001', :'b', 'SHIPPER 0283', date '2026-02-01', 10, :'v', array['F0283A']),
  ('00000000-0000-0000-0000-000000000001', :'b', 'Shipper 0283', date '2026-02-01', 11, :'v', '{}'),
  ('00000000-0000-0000-0000-000000000001', :'b', 'SHIPPER 0283', date '2026-02-05', 12, :'v', '{}');
select count(*) = 1 as loaded from (select public.freight_bill_loaded(:'b')) x;
select (select bool_and(confirmed and order_id = :'o') from public.freight_bill_lines where bill_id = :'b' and ship_date = date '2026-02-01') as packages_follow,
       (select not confirmed from public.freight_bill_lines where bill_id = :'b' and ship_date = date '2026-02-05') as other_day_waits,
       (select status from public.freight_bills where id = :'b') = 'to_match' as still_open;
delete from public.freight_bills where id = :'b';
delete from public.orders where id = :'o';
delete from public.carriers where id = :'c';
delete from public.vendors where id = :'v';
