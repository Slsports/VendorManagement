\set ON_ERROR_STOP on
\pset footer off
\echo '>>> booth-mates: a vendor with no rep group in a booth with two of a rep group''s lines gets a card; Yes adds it'
reset role;
insert into public.rep_groups (organization_id, name) values ('00000000-0000-0000-0000-000000000001', 'Booth Test Reps') returning id as g \gset
insert into public.vendors (organization_id, name, rep_group_id) values ('00000000-0000-0000-0000-000000000001', 'BT Line One', :'g') returning id as v1 \gset
insert into public.vendors (organization_id, name, rep_group_id) values ('00000000-0000-0000-0000-000000000001', 'BT Line Two', :'g') returning id as v2 \gset
insert into public.vendors (organization_id, name) values ('00000000-0000-0000-0000-000000000001', 'BT Loner') returning id as v3 \gset
insert into public.vendor_directory (organization_id, source, name, matched_vendor_id) values
  ('00000000-0000-0000-0000-000000000001', 'bt', 'BT Line One', :'v1'), ('00000000-0000-0000-0000-000000000001', 'bt', 'BT Line Two', :'v2'), ('00000000-0000-0000-0000-000000000001', 'bt', 'BT Loner', :'v3');
insert into public.show_appearances (organization_id, show_code, show_label, line_id, vendor_id, booth)
select '00000000-0000-0000-0000-000000000001', 'bt_show', 'BT Show', d.id, d.matched_vendor_id, '777' from public.vendor_directory d where d.source = 'bt';
select public.show_booth_rep_cards('00000000-0000-0000-0000-000000000001') >= 1 as made;
select title from public.review_items where kind = 'booth_rep' and entity_id = :'v3';
set role authenticated;
select set_config('request.jwt.claims', '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}', false);
select public.resolve_booth_rep((select id from public.review_items where kind = 'booth_rep' and entity_id = :'v3'), true);
reset role;
select rep_group_id = :'g' as added from public.vendors where id = :'v3';
