\set ON_ERROR_STOP on
\pset footer off
\echo '>>> Item names: approve, leave as is, undo; content renames sent go on one shelf-tag task for logistics'
reset role;
select set_config('request.jwt.claims', '', false) is not null as service;
update public.profiles set handles_logistics = false where organization_id = '00000000-0000-0000-0000-000000000001';
-- an editor approves two renames and leaves one name as it is
set role authenticated;
select set_config('request.jwt.claims', '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}', false) is not null as admin_in;
select public.item_names_decide('00000000-0000-0000-0000-000000000001', '[
  {"ls_item_id":"t185-1","old_name":"TEE GREY MEDIUM","new_name":"tee gray med","kind":"cosmetic"},
  {"ls_item_id":"t185-2","old_name":"STOOL BLUE","new_name":"STOOL BLUE 8256","kind":"content"},
  {"ls_item_id":"t185-4","old_name":"SAME","new_name":"SAME","kind":"cosmetic"}]'::jsonb) = 2 as two_approved;
select public.item_names_decide('00000000-0000-0000-0000-000000000001', '[{"ls_item_id":"t185-3","old_name":"ODD NAME"}]'::jsonb, true) = 1 as one_left;
select new_name = 'TEE GRAY MED' as upper_cased from public.item_name_changes where ls_item_id = 't185-1';
-- approving again replaces the waiting one
select public.item_names_decide('00000000-0000-0000-0000-000000000001', '[{"ls_item_id":"t185-1","old_name":"TEE GREY MEDIUM","new_name":"TEE GRAY MED","kind":"cosmetic"}]'::jsonb) = 1 as replaced;
select count(*) = 1 as still_one from public.item_name_changes where ls_item_id = 't185-1';
reset role;
-- the queue sends them; the content one goes on a shelf-tag task for the admin (no logistics person here)
update public.item_name_changes set status = 'sent', sent_at = now() where ls_item_id in ('t185-1', 't185-2');
select public.item_names_shelf_task('00000000-0000-0000-0000-000000000001') is not null as task_made;
select t.title = 'Print new shelf tags (1 item)' as title_ok, t.assigned_to = '11111111-1111-1111-1111-111111111111' as to_admin,
       t.notes like '%STOOL BLUE  →  STOOL BLUE 8256%' as lists_item, t.due_date = (now() at time zone 'America/Los_Angeles')::date + 7 as due_7
from public.tasks t where t.id = (select task_id from public.item_name_changes where ls_item_id = 't185-2');
select (select task_id from public.item_name_changes where ls_item_id = 't185-1') is null as cosmetic_no_task;
select public.item_names_shelf_task('00000000-0000-0000-0000-000000000001') is null as nothing_more;
-- undo the left-as-is choice
set role authenticated;
select set_config('request.jwt.claims', '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}', false) is not null as admin_in;
select public.item_names_undo(array(select id from public.item_name_changes where ls_item_id = 't185-3')) = 1 as undone;
reset role;
-- the SOP vendors end names with the Vendor ID
select count(*) = 0 as no_unset from public.vendors where upper(name) in ('LAZY ONE', 'TY INC') and not vid_in_description;
delete from public.tasks where id in (select task_id from public.item_name_changes where ls_item_id like 't185-%');
delete from public.item_name_changes where ls_item_id like 't185-%';
