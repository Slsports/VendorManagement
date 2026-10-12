\set ON_ERROR_STOP on
\pset footer off
\echo '>>> show lines: an alias match, a sure Claude match and a maybe card'
reset role;
select public.name_norm('ROYAL DELUXE ACCESSORIES - WWD') as a, public.name_norm('Royal Deluxe, Inc.') as b;
insert into public.vendors (organization_id, name) values ('00000000-0000-0000-0000-000000000001', 'SLR TEST DELUXE ACCESSORIES') returning id as v \gset
insert into public.vendor_directory (organization_id, source, name) values ('00000000-0000-0000-0000-000000000001', 'slr_test', 'SLR Test Deluxe') returning id as l1 \gset
insert into public.vendor_directory (organization_id, source, name) values ('00000000-0000-0000-0000-000000000001', 'slr_test', 'SLRT Deluxe Co') returning id as l2 \gset
insert into public.show_appearances (organization_id, show_code, show_label, line_id, booth) values
  ('00000000-0000-0000-0000-000000000001', 'slr_show', 'Test Show', :'l1', '517'), ('00000000-0000-0000-0000-000000000001', 'slr_show', 'Test Show', :'l2', '518');
select count(*) as queued from public.show_line_queue('00000000-0000-0000-0000-000000000001', 1000) where line_id in (:'l1', :'l2');
select public.show_line_apply(:'l1', :'v', true) as first, public.show_line_apply(:'l2', :'v', false) as second;
select vendor_id = :'v' as tied from public.show_appearances where line_id = :'l1';
select title from public.review_items where kind = 'show_line' and details->>'line_id' = :'l2';
set role authenticated;
select set_config('request.jwt.claims', '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}', false);
select public.resolve_show_line((select id from public.review_items where kind = 'show_line' and details->>'line_id' = :'l2'), true);
reset role;
select vendor_id = :'v' as tied_after_yes from public.show_appearances where line_id = :'l2';
