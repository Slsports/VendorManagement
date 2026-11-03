\set ON_ERROR_STOP on
\pset footer off
\echo '>>> 0296: one parent company billing several brands: the invoice goes to the brand of its PO, else the brand in the name'
reset role;
select set_config('request.jwt.claims', '', false) is not null as service;
insert into public.vendors (organization_id, name, parent_company, wwd_billing_names) values
  ('00000000-0000-0000-0000-000000000001', 'BRAND296A', 'Parent 296 Inc', array['PARENT 296 DBA BRAND296C', 'PARENT 296 INC']) returning id as va \gset
insert into public.vendors (organization_id, name, parent_company, wwd_billing_names) values
  ('00000000-0000-0000-0000-000000000001', 'BRAND296C', 'Parent 296 Inc', array['PARENT 296 DBA BRAND296C', 'PARENT 296 INC']) returning id as vc \gset
insert into public.orders (organization_id, vendor_id, po_number, status) values ('00000000-0000-0000-0000-000000000001', :'va', 'BRAND296A1', 'entered') returning id as oa \gset
insert into public.wwd_invoices (organization_id, seq, kind, wwd_vendor_name, amount, order_id) values
  ('00000000-0000-0000-0000-000000000001', '9296001', 'invoice', 'PARENT 296 DBA BRAND296C', 100, :'oa') returning id as w1 \gset
insert into public.wwd_invoices (organization_id, seq, kind, wwd_vendor_name, amount) values
  ('00000000-0000-0000-0000-000000000001', '9296002', 'invoice', 'Parent 296 DBA Brand296C', 50) returning id as w2 \gset
insert into public.wwd_invoices (organization_id, seq, kind, wwd_vendor_name, amount) values
  ('00000000-0000-0000-0000-000000000001', '9296003', 'invoice', 'PARENT 296 INC', 25) returning id as w3 \gset
select public.wwd_billing_names_link('00000000-0000-0000-0000-000000000001') >= 2 as linked;
select (select vendor_id from public.wwd_invoices where id = :'w1') = :'va' as by_po,
       (select vendor_id from public.wwd_invoices where id = :'w2') = :'vc' as by_name_in_dba,
       (select vendor_id from public.wwd_invoices where id = :'w3') is null as unclear_left_alone;
delete from public.wwd_invoices where id in (:'w1', :'w2', :'w3');
delete from public.orders where id = :'oa';
delete from public.vendors where id in (:'va', :'vc');
