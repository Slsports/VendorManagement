\set ON_ERROR_STOP on
\pset footer off
\echo '>>> 0303: the PO-name rule'
reset role;
select set_config('request.jwt.claims', '', false) is not null as service;
insert into public.vendors (organization_id, name) values ('00000000-0000-0000-0000-000000000001', 'PONAME LUX') returning id as v \gset
insert into public.vendors (organization_id, name) values ('00000000-0000-0000-0000-000000000001', 'TWINNAME A'), ('00000000-0000-0000-0000-000000000001', 'TWIN-NAME A');
insert into public.wwd_invoices (organization_id, seq, kind, amount, wwd_vendor_name, po_number) values
  ('00000000-0000-0000-0000-000000000001', '9930301', 'invoice', 10, 'Unknownparent Products Corp', 'PONAMELUX82725'),
  ('00000000-0000-0000-0000-000000000001', '9930302', 'invoice', 11, 'Unknownparent Two', 'TWINNAMEA2-1-26'),
  ('00000000-0000-0000-0000-000000000001', '9930303', 'invoice', 12, 'Unknownparent Three', 'SPR2026');
select public.wwd_relink('00000000-0000-0000-0000-000000000001') is not null as ran;
\echo '>>> the PO names one vendor: filed there, WWD name kept as its alias'
select vendor_id = :'v' as po_name_vendor from public.wwd_invoices where seq = '9930301';
select 'Unknownparent Products Corp' = any (aliases) as alias_added from public.vendors where id = :'v';
\echo '>>> two vendors with that name, or no vendor name in the PO: left to match'
select (select vendor_id from public.wwd_invoices where seq = '9930302') is null as twins_left,
       (select vendor_id from public.wwd_invoices where seq = '9930303') is null as season_po_left;
\echo '>>> a person''s choice is never changed'
update public.wwd_invoices set vendor_id = null, vendor_set_by = 'person' where seq = '9930301';
select public.wwd_relink('00000000-0000-0000-0000-000000000001') is not null as ran_again;
select vendor_id is null as person_kept from public.wwd_invoices where seq = '9930301';
delete from public.wwd_invoices where seq in ('9930301', '9930302', '9930303');
delete from public.vendors where name in ('PONAME LUX', 'TWINNAME A', 'TWIN-NAME A');
