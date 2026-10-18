\set ON_ERROR_STOP on
\pset footer off
\echo '>>> Zero upcharge card (left from the Oct 17 portal read): Use the portal''s sets the flag'
reset role;
select set_config('request.jwt.claims', '', false) is not null as service;
insert into public.vendors (organization_id, name) values ('00000000-0000-0000-0000-000000000001', 'Zero Test Sports') returning id as v \gset
insert into public.review_items (organization_id, kind, entity_type, entity_id, title, details)
values ('00000000-0000-0000-0000-000000000001', 'portal_conflict', 'vendor', :'v', 'Zero Test Sports: the Worldwide portal says zero upcharge Yes',
        jsonb_build_object('vendor_id', :'v', 'field', 'wwd_zero_upcharge', 'label', 'Zero upcharge', 'ours', 'No', 'portal', 'Yes'));
select public.portal_field_label('wwd_zero_upcharge') as label;
set role authenticated;
select set_config('request.jwt.claims', '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}', false) is not null as admin_in;
select public.resolve_portal_conflict(id, true) from public.review_items where entity_id = :'v' and kind = 'portal_conflict';
reset role;
select set_config('request.jwt.claims', '', false) is not null as service;
select wwd_zero_upcharge as now_zero from public.vendors where id = :'v';
delete from public.review_items where entity_id = :'v';
delete from public.vendors where id = :'v';
