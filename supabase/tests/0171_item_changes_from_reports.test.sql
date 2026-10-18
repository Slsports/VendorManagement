\set ON_ERROR_STOP on
\pset footer off
\echo '>>> Report dead ends: one card per LS item, Find replacement makes a task, the replacement finishes it, Don''t need notes LS'
reset role;
select set_config('request.jwt.claims', '', false) is not null as service;
insert into public.vendors (organization_id, name, lightspeed_vendor_id) values ('00000000-0000-0000-0000-000000000001', 'BECKER TEST - WWD', 'TV158') returning id as v \gset
insert into public.ls_items (organization_id, item_id, description, default_vendor_id, vendor_item_id, note) values ('00000000-0000-0000-0000-000000000001', 'TI158', '*OLD GLOVE 63300', 'TV158', '63300', 'Replaced with new styles');
update public.profiles set note_initials = 'DP' where id = '11111111-1111-1111-1111-111111111111';
set role authenticated;
select set_config('request.jwt.claims', '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}', false) is not null as admin_in;
select ls_item_id, decision, review_item_id is not null as has_card from public.item_changes_from_report('00000000-0000-0000-0000-000000000001', '[{"ls_item_id": "TI158", "vendor_item_id": "63300", "item_name": "*OLD GLOVE 63300", "ls_vendor_id": "TV158", "ls_note": "Replaced with new styles"}]');
-- a second report run finds the same card, no new one
select count(*) as one_change from public.item_changes where ls_item_id = 'TI158' and source = 'report';
select ls_item_id, change_id = (select id from public.item_changes where ls_item_id = 'TI158') as same_card from public.item_changes_from_report('00000000-0000-0000-0000-000000000001', '[{"ls_item_id": "TI158", "vendor_item_id": "63300", "item_name": "*OLD GLOVE 63300", "ls_vendor_id": "TV158"}]');
select title, assigned_to::text = '11111111-1111-1111-1111-111111111111' as mine from public.review_items where id = (select review_item_id from public.item_changes where ls_item_id = 'TI158');
-- Find replacement: a task on the list, nothing to write to LS
select decision, ls_status, task_id is not null as has_task from public.item_change_decide((select id from public.item_changes where ls_item_id = 'TI158'), 'find_replacement');
select title, auto_key, done_at is null as open from public.tasks where id = (select task_id from public.item_changes where ls_item_id = 'TI158');
-- the replacement found: written to LS, the task done
select decision, note_line ~ '^\d{1,2}/\d{1,2}/\d{2} DP: REPLACED WITH 63360$' as dated_note, ls_status from public.item_change_decide((select id from public.item_changes where ls_item_id = 'TI158'), 'replacement', null, null, '63360');
select done_at is not null as task_done, done_note from public.tasks where id = (select task_id from public.item_changes where ls_item_id = 'TI158');
select status, resolution_note from public.review_items where id = (select review_item_id from public.item_changes where ls_item_id = 'TI158');
-- already decided: no second decision
do $$ begin
  perform public.item_change_decide((select id from public.item_changes where ls_item_id = 'TI158'), 'dont_need');
  raise exception 'a decided item was decided again';
exception when others then if sqlerrm not like '%already decided%' then raise; end if; end $$;
-- Don't need on another item: a dated NO REPLACEMENT NEEDED line
reset role;
select set_config('request.jwt.claims', '', false) is not null as service;
insert into public.ls_items (organization_id, item_id, description, default_vendor_id, vendor_item_id) values ('00000000-0000-0000-0000-000000000001', 'TI159', '*OLD HAT', 'TV158', '63301');
set role authenticated;
select set_config('request.jwt.claims', '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}', false) is not null as admin_in;
select count(*) as made from public.item_changes_from_report('00000000-0000-0000-0000-000000000001', '[{"ls_item_id": "TI159", "vendor_item_id": "63301", "item_name": "*OLD HAT", "ls_vendor_id": "TV158"}]');
select decision, note_line ~ 'DP: NO REPLACEMENT NEEDED$' as dated_note, ls_status from public.item_change_decide((select id from public.item_changes where ls_item_id = 'TI159'), 'dont_need');
reset role;
select set_config('request.jwt.claims', '', false) is not null as service;
delete from public.tasks where auto_key like 'item_change:%' and organization_id = '00000000-0000-0000-0000-000000000001';
delete from public.review_items where id in (select review_item_id from public.item_changes where ls_item_id in ('TI158', 'TI159'));
delete from public.item_changes where ls_item_id in ('TI158', 'TI159');
delete from public.ls_items where item_id in ('TI158', 'TI159');
delete from public.vendors where id = :'v';
update public.profiles set note_initials = null where id = '11111111-1111-1111-1111-111111111111';
