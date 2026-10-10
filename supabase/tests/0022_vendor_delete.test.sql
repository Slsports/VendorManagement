\set ON_ERROR_STOP on
\pset footer off
\echo '>>> JW deletes a vendor that is not a vendor: gone, its review closed, its names remembered'
reset role;
select set_config('request.jwt.claims', '', false) is not null as as_service;
insert into public.vendors (organization_id, name, lightspeed_name, aliases) values ('00000000-0000-0000-0000-000000000001', 'SLS Internal Consumption', 'SHAVER LAKE SPORTS INTERNAL', '{"SLS INTERNAL USE"}') returning id as dv \gset
insert into public.review_items (organization_id, kind, entity_type, entity_id, title) values ('00000000-0000-0000-0000-000000000001', 'vendor_rename', 'vendor', :'dv', 'rename') returning id as dri \gset
insert into public.vendors (organization_id, name) values ('00000000-0000-0000-0000-000000000001', 'Delete Test Has Orders') returning id as ov \gset
insert into public.orders (organization_id, vendor_id) values ('00000000-0000-0000-0000-000000000001', :'ov');
set role authenticated;
select set_config('request.jwt.claims', '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}', false);
select public.delete_vendor(:'dv');
select count(*) as vendor_left from public.vendors where id = :'dv';
select status, resolution_note from public.review_items where id = :'dri';
select name from public.vendor_exclusions order by name;
\echo '>>> a vendor with orders is kept; a person re-adding a deleted name is told why; the viewer cannot delete (expect 3 errors)'
\set ON_ERROR_STOP off
select public.delete_vendor(:'ov');
insert into public.vendors (organization_id, name) values ('00000000-0000-0000-0000-000000000001', 'SLS internal consumption');
select set_config('request.jwt.claims', '{"sub":"44444444-4444-4444-4444-444444444444","role":"authenticated"}', false);
select public.delete_vendor(:'ov');
\set ON_ERROR_STOP on
\echo '>>> an import (no signed-in user) skips the deleted name quietly, by name or Lightspeed name'
reset role;
select set_config('request.jwt.claims', '', false) is not null as as_service;
insert into public.vendors (organization_id, name) values ('00000000-0000-0000-0000-000000000001', 'SLS Internal Consumption') returning id;
insert into public.vendors (organization_id, name, lightspeed_name) values ('00000000-0000-0000-0000-000000000001', 'Something', 'Shaver Lake Sports Internal') returning id;
select count(*) as kept_with_orders from public.vendors where id = :'ov';
