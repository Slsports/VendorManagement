\set ON_ERROR_STOP on
\pset footer off
\echo '>>> LS POs: a confirmed order starts a draft; approve by the orderer, review and finish by the reviewer; tasks follow'
reset role;
select id as admin_id from public.profiles where organization_id = '00000000-0000-0000-0000-000000000001' and role = 'admin' and is_active order by created_at limit 1 \gset
insert into auth.users (id, email) values ('11111111-2222-3333-4444-555555555555', 'mbx-mgr@example.com') on conflict do nothing;
insert into public.profiles (id, organization_id, email, full_name, role, is_active, reviews_ls_pos) values ('11111111-2222-3333-4444-555555555555', '00000000-0000-0000-0000-000000000001', 'mbx-mgr@example.com', 'Morgan Test', 'manager', true, true) on conflict (id) do update set role = 'manager', is_active = true, reviews_ls_pos = true;
insert into public.vendors (organization_id, name) values ('00000000-0000-0000-0000-000000000001', 'LS PO Test Vendor') returning id as v \gset
insert into public.orders (organization_id, vendor_id, status, po_number, placed_by_id) values ('00000000-0000-0000-0000-000000000001', :'v', 'open', 'T-1', :'admin_id') returning id as o \gset
update public.orders set status = 'confirmed' where id = :'o';
select id as p, status, approver_id = :'admin_id' as approver_is_orderer, reviewer_id = '11111111-2222-3333-4444-555555555555' as reviewer_is_morgan from public.ls_pos where order_id = :'o' \gset
select :'status' as status, :'approver_is_orderer' as approver_is_orderer, :'reviewer_is_morgan' as reviewer_is_morgan;
-- drafted (the function does this): waits on the orderer, with a task
update public.ls_pos set status = 'to_approve', lines = '[{"vid":"A1","qty":2}]' where id = :'p';
select assigned_to = :'admin_id' as approve_task_to_orderer from public.tasks where auto_key = 'lspo:' || :'p' || ':to_approve' and done_at is null;
-- the reviewer cannot approve; the orderer can
set role authenticated;
select set_config('request.jwt.claims', '{"sub":"11111111-2222-3333-4444-555555555555","role":"authenticated"}', false) is not null as as_morgan;
\set ON_ERROR_STOP off
select public.ls_po_action(:'p', 'approve');
\set ON_ERROR_STOP on
select set_config('request.jwt.claims', json_build_object('sub', :'admin_id', 'role', 'authenticated')::text, false) is not null as as_admin;
select public.ls_po_action(:'p', 'approve', '[{"vid":"A1","qty":3}]'::jsonb);
select set_config('request.jwt.claims', '{"sub":"11111111-2222-3333-4444-555555555555","role":"authenticated"}', false) is not null as as_morgan_again;
select public.ls_po_action(:'p', 'send');
select public.ls_po_action(:'p', 'done', null, 'LS-555');
reset role;
select status, lines->0->>'qty' as qty from public.ls_pos where id = :'p';
select ls_po_number from public.orders where id = :'o';
select count(*) filter (where done_at is null) as open_tasks, count(*) as all_tasks from public.tasks where auto_key like 'lspo:' || :'p' || ':%';
select public.sync_payment_tasks('00000000-0000-0000-0000-000000000001') is not null as pay_sync_leaves_lspo_alone;
delete from public.tasks where auto_key like 'lspo:' || :'p' || ':%';
delete from public.ls_pos where id = :'p';
delete from public.orders where id = :'o';
delete from public.vendors where id = :'v';
update public.profiles set reviews_ls_pos = false where id = '11111111-2222-3333-4444-555555555555';
