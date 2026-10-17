\set ON_ERROR_STOP on
\pset footer off
\echo '>>> Zero upcharge from the portal: a different answer is asked, Use the portal''s sets it; portal lines are marked'
reset role;
select set_config('request.jwt.claims', '', false) is not null as service;
insert into public.vendors (organization_id, name) values ('00000000-0000-0000-0000-000000000001', 'Zero Test Sports') returning id as v \gset
insert into public.wwd_portal_vendors (organization_id, number, name, read_at, vendor_id, match_how, data) values ('00000000-0000-0000-0000-000000000001', 'Z1', 'Zero Test Sports Inc', now(), :'v', 'exact',
  '{"address": {}, "standard": {}, "contacts": [], "programs": [], "resources": {"rebate_program": true}}'::jsonb) returning id as w \gset
select public.wwd_portal_apply(:'w')->'asked' as asked;
select details->>'ours' as ours, details->>'portal' as portal, title from public.review_items where entity_id = :'v' and kind = 'portal_conflict';
select (public.wwd_portal_apply(:'w')->'asked') = '[]'::jsonb as not_asked_twice;
set role authenticated;
select set_config('request.jwt.claims', '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}', false) is not null as admin_in;
select public.resolve_portal_conflict(id, true) from public.review_items where entity_id = :'v' and kind = 'portal_conflict';
reset role;
select set_config('request.jwt.claims', '', false) is not null as service;
select wwd_zero_upcharge as now_zero from public.vendors where id = :'v';
-- a portal line marked zero upcharge
insert into public.vendor_directory (organization_id, source, name) values ('00000000-0000-0000-0000-000000000001', 'wwd_portal', 'Zero Test Line') returning id as l \gset
insert into public.wwd_portal_vendors (organization_id, number, name, read_at, line_id, data) values ('00000000-0000-0000-0000-000000000001', 'Z2', 'Zero Test Line', now(), :'l',
  '{"resources": {"zero_upcharge": true}}'::jsonb) returning id as w2 \gset
select (public.wwd_portal_apply_all('00000000-0000-0000-0000-000000000001')) is not null as ran;
select zero_upcharge as line_zero from public.vendor_directory where id = :'l';
delete from public.review_items where entity_id = :'v';
delete from public.wwd_portal_vendors where id in (:'w', :'w2');
delete from public.vendor_directory where id = :'l';
delete from public.vendors where id = :'v';
