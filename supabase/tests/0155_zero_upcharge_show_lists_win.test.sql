\set ON_ERROR_STOP on
\pset footer off
\echo '>>> Zero upcharge: the portal no longer asks or marks lines (show lists win)'
reset role;
select set_config('request.jwt.claims', '', false) is not null as service;
insert into public.vendors (organization_id, name) values ('00000000-0000-0000-0000-000000000001', 'Zero Win Test') returning id as v \gset
insert into public.wwd_portal_vendors (organization_id, number, name, read_at, vendor_id, match_how, data) values ('00000000-0000-0000-0000-000000000001', 'ZW1', 'Zero Win Test', now(), :'v', 'exact',
  '{"address": {}, "standard": {}, "contacts": [], "programs": [], "resources": {"zero_upcharge": true}}'::jsonb) returning id as w \gset
select public.wwd_portal_apply(:'w')->'asked' as asked_nothing;
select count(*) as no_card from public.review_items where entity_id = :'v';
select wwd_zero_upcharge as unchanged from public.vendors where id = :'v';
insert into public.vendor_directory (organization_id, source, name) values ('00000000-0000-0000-0000-000000000001', 'wwd_portal', 'Zero Win Line') returning id as l \gset
insert into public.wwd_portal_vendors (organization_id, number, name, read_at, line_id, data) values ('00000000-0000-0000-0000-000000000001', 'ZW2', 'Zero Win Line', now(), :'l', '{"resources": {"zero_upcharge": true}}'::jsonb) returning id as w2 \gset
select public.wwd_portal_apply_all('00000000-0000-0000-0000-000000000001') is not null as ran;
select zero_upcharge as line_not_marked from public.vendor_directory where id = :'l';
delete from public.wwd_portal_vendors where id in (:'w', :'w2');
delete from public.vendor_directory where id = :'l';
delete from public.vendors where id = :'v';
