\set ON_ERROR_STOP on
\pset footer off
\echo '>>> Usual charges: added from a check row, a second one with the same name updates the price'
reset role;
select set_config('request.jwt.claims', '', false) is not null as service;
insert into public.vendors (organization_id, name) values ('00000000-0000-0000-0000-000000000001', 'Charge Test Co') returning id as v \gset
set role authenticated;
select set_config('request.jwt.claims', '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}', false) is not null as admin_in;
select public.vendor_usual_charge_add(:'v', 'Tags', 0.15, 'each');
select public.vendor_usual_charge_add(:'v', 'Hang tags', 0.10, null);
select public.vendor_usual_charge_add(:'v', 'tags', 0.18, 'each') as tags_price_updated;
select usual_charges, ask_before_pictures from public.vendors where id = :'v';
reset role;
select set_config('request.jwt.claims', '', false) is not null as service;
delete from public.vendors where id = :'v';
