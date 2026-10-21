\set ON_ERROR_STOP on
\pset footer off
\echo '>>> A vendor invoice WWD posted twice gives its order the items once'
reset role;
select set_config('request.jwt.claims', '', false) is not null as service;
insert into public.vendors (organization_id, name) values ('00000000-0000-0000-0000-000000000001', 'REP219') returning id as v \gset
insert into public.orders (organization_id, vendor_id, status, po_number) values ('00000000-0000-0000-0000-000000000001', :'v', 'entered', 'REP091526') returning id as o \gset
insert into public.wwd_invoices (organization_id, seq, kind, vendor_id, po_number, vendor_invoice_number, amount, order_id) values
  ('00000000-0000-0000-0000-000000000001', '9200001', 'invoice', :'v', 'REP091526', '100056IN', 10, :'o'),
  ('00000000-0000-0000-0000-000000000001', '9200002', 'invoice', :'v', 'REP091526', '100056IN', 10, :'o');
select public.wwd_edenred_lines(jsonb_build_object('organization_id', '00000000-0000-0000-0000-000000000001', 'invoices', jsonb_build_array(
  jsonb_build_object('seq', '9200001', 'lines', jsonb_build_array(jsonb_build_object('vid', 'A', 'desc', 'a', 'qty', '1', 'price', '10', 'amount', '10'))),
  jsonb_build_object('seq', '9200002', 'lines', jsonb_build_array(jsonb_build_object('vid', 'A', 'desc', 'a', 'qty', '1', 'price', '10', 'amount', '10')))))) is not null as loaded;
select count(*) = 1 as items_once from public.order_lines where order_id = :'o';
delete from public.order_lines where order_id = :'o';
delete from public.wwd_invoices where vendor_id = :'v';
delete from public.orders where id = :'o';
delete from public.vendors where id = :'v';
