\set ON_ERROR_STOP on
\pset footer off
\echo '>>> 0302: a WWD invoice already on file without a name gets its vendor when the paper fills the name in'
reset role;
select set_config('request.jwt.claims', '', false) is not null as service;
insert into public.vendors (organization_id, name, aliases) values ('00000000-0000-0000-0000-000000000001', 'PAPERNAME302', array['Papername Trading']) returning id as v \gset
insert into public.wwd_invoices (organization_id, seq, kind, amount) values ('00000000-0000-0000-0000-000000000001', '9930201', 'invoice', 55.10);
select (r->>'placed')::boolean and r->>'vendor_id' = :'v' as placed_on_vendor
  from public.wwd_edenred_place('00000000-0000-0000-0000-000000000001', '{"seq":"09930201","vendor_invoice_number":"PN-1","vendor_name":"Papername Trading Ltd","amount":55.10}') r;
select vendor_id = :'v' and wwd_vendor_name = 'Papername Trading Ltd' as invoice_has_vendor from public.wwd_invoices where seq = '9930201';
delete from public.wwd_invoices where seq = '9930201';
delete from public.vendors where id = :'v';
