\set ON_ERROR_STOP on
\pset footer off
\echo '>>> Vendor ID in names: vendor default off; order and line follow until set'
reset role;
insert into public.vendors (organization_id, name) values ('00000000-0000-0000-0000-000000000001', 'Vidtest Co') returning id as v \gset
insert into public.orders (organization_id, vendor_id, status) values ('00000000-0000-0000-0000-000000000001', :'v', 'open') returning id as o \gset
insert into public.order_lines (order_id, vendor_item_id, description, quantity, unit_cost) values (:'o', 'AB1234', 'MENS HOODIE NAVY', 1, 10) returning id as l \gset
select v.vid_in_description as vendor, o.vid_in_description as order_setting, l.vid_in_description as line_setting
  from public.vendors v join public.orders o on o.vendor_id = v.id join public.order_lines l on l.order_id = o.id where l.id = :'l';
