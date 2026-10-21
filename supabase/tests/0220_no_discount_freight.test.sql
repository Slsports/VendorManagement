\set ON_ERROR_STOP on
\pset footer off
\echo '>>> Edenred NDOF Amount is kept beside N/D Freight'
reset role;
select set_config('request.jwt.claims', '', false) is not null as service;
insert into public.vendors (organization_id, name) values ('00000000-0000-0000-0000-000000000001', 'NDOF220') returning id as v \gset
insert into public.wwd_invoices (organization_id, seq, kind, vendor_id, amount) values
  ('00000000-0000-0000-0000-000000000001', '9220001', 'invoice', :'v', 100) returning id as w \gset
select public.wwd_edenred_lines(jsonb_build_object('organization_id', '00000000-0000-0000-0000-000000000001', 'invoices', jsonb_build_array(
  jsonb_build_object('seq', '9220001', 'nd_freight', 'Y', 'ndof', '21.41', 'freight', '21.41', 'lines', jsonb_build_array())))) is not null as loaded;
select nd_freight and ndof_amount = 21.41 as kept from public.wwd_invoices where id = :'w';
-- a later export without the amount keeps it
select public.wwd_edenred_lines(jsonb_build_object('organization_id', '00000000-0000-0000-0000-000000000001', 'invoices', jsonb_build_array(
  jsonb_build_object('seq', '9220001', 'nd_freight', 'Y', 'lines', jsonb_build_array())))) is not null as again;
select ndof_amount = 21.41 as still_kept from public.wwd_invoices where id = :'w';
delete from public.wwd_invoices where id = :'w';
delete from public.vendors where id = :'v';
