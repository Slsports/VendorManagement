\set ON_ERROR_STOP on
\pset footer off
\echo '>>> PO numbers: [code][MMDDYY], -2 for a second one that day; LS vendor names match'
reset role;
select set_config('request.jwt.claims', '', false) is not null as service;
select public.po_code_default('YAKIMA') a, public.po_code_default('Kelli''s') b, public.po_code_default('Shark Eyes') c, public.po_code_default('WORLD FAMOUS SPORTS') d, public.po_code_default('Yakima - WWD') e;
select public.ls_vendor_key('YAKIMA - WWD') = public.ls_vendor_key('Yakima') y, public.ls_vendor_key('IMPLUS (WWD)') = public.ls_vendor_key('Implus') i,
       public.ls_vendor_key('KIDGALAXY WWD') = public.ls_vendor_key('Kid Galaxy') k, public.ls_vendor_key('AQUA CASE - FAIRE & WWD') = public.ls_vendor_key('Aqua Case') a;
insert into public.vendors (organization_id, name) values ('00000000-0000-0000-0000-000000000001', 'Yakima Test') returning id as v \gset
insert into public.orders (organization_id, vendor_id, status, order_date, source) values ('00000000-0000-0000-0000-000000000001', :'v', 'open', '2026-08-06', 'email') returning id as o1 \gset
insert into public.orders (organization_id, vendor_id, status, order_date, source) values ('00000000-0000-0000-0000-000000000001', :'v', 'open', '2026-08-06', 'email') returning id as o2 \gset
select public.po_number_next(:'o1') as first;
update public.orders set po_number = public.po_number_next(:'o1') where id = :'o1';
select public.po_number_next(:'o2') as second_same_day;
insert into public.ls_vendors (organization_id, ls_vendor_id, name) values ('00000000-0000-0000-0000-000000000001', '901', 'YAKIMA TEST - WWD');
select public.ls_vendors_match('00000000-0000-0000-0000-000000000001') >= 1 as matched, (select lightspeed_vendor_id from public.vendors where id = :'v') as ls_id;
\echo '>>> a buyer sets the PO code'
set role authenticated;
select set_config('request.jwt.claims', '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}', false) is not null as signed_in;
select public.vendor_set_ls(:'v', '901', 'yak-t');
reset role;
select set_config('request.jwt.claims', '', false) is not null as service;
select po_code, lightspeed_vendor_id, lightspeed_name, public.po_number_next(:'o2') as next from public.vendors where id = :'v';
delete from public.ls_pos where vendor_id = :'v';
delete from public.orders where vendor_id = :'v';
delete from public.vendors where id = :'v';
delete from public.ls_vendors where ls_vendor_id = '901';
