\set ON_ERROR_STOP on
\pset footer off
\echo '>>> Inventory counts: only the Enter inventory counts tick may type counts, and only while the checklist is open'
reset role;
select set_config('request.jwt.claims', '', false) is not null as claims_cleared;
select id as admin_id from public.profiles where organization_id = '00000000-0000-0000-0000-000000000001' and role = 'admin' and is_active order by created_at limit 1 \gset
insert into auth.users (id, email) values ('00000000-0000-0000-0000-00000000c0c1', 'counter@example.com') on conflict do nothing;
insert into public.profiles (id, organization_id, email, full_name, role, is_active) values ('00000000-0000-0000-0000-00000000c0c1', '00000000-0000-0000-0000-000000000001', 'counter@example.com', 'Counter', 'viewer', true)
  on conflict (id) do update set role = 'viewer', is_active = true, enters_counts = false, sends_counts = false;
insert into public.inventory_counts (organization_id, title, store_code, shop_id, created_by) values ('00000000-0000-0000-0000-000000000001', 'CAMPING INVENTORY', 'SLS', '3', :'admin_id') returning id as cnt \gset
insert into public.inventory_count_lines (organization_id, count_id, item_id, description, in_stock, sort_order) values ('00000000-0000-0000-0000-000000000001', :'cnt', 'i1', 'STOVE', 4, 1) returning id as line \gset
-- a viewer without the tick cannot enter counts (the update changes nothing)
set role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000c0c1","role":"authenticated"}', false) is not null as as_viewer;
update public.inventory_count_lines set floor = 2, total = 2 where id = :'line';
select total is null as viewer_could_not_count from public.inventory_count_lines where id = :'line';
reset role;
select set_config('request.jwt.claims', '', false) is not null as claims_cleared;
update public.profiles set enters_counts = true where id = '00000000-0000-0000-0000-00000000c0c1';
set role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000c0c1","role":"authenticated"}', false) is not null as as_counter;
update public.inventory_count_lines set floor = 2, bins = 1, total = 3 where id = :'line';
select total as counter_entered from public.inventory_count_lines where id = :'line';
-- the counter cannot change the ticks
do $$ begin
  update public.profiles set sends_counts = true where id = '00000000-0000-0000-0000-00000000c0c1';
  raise exception 'a non-admin changed a tick';
exception when insufficient_privilege then null; end $$;
reset role;
select set_config('request.jwt.claims', '', false) is not null as claims_cleared;
update public.inventory_counts set status = 'sent' where id = :'cnt';
set role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000c0c1","role":"authenticated"}', false) is not null as as_counter;
update public.inventory_count_lines set total = 9 where id = :'line';
select total as sent_checklist_unchanged from public.inventory_count_lines where id = :'line';
reset role;
select set_config('request.jwt.claims', '', false) is not null as claims_cleared;
delete from public.inventory_counts where id = :'cnt';
delete from public.profiles where id = '00000000-0000-0000-0000-00000000c0c1';
delete from auth.users where id = '00000000-0000-0000-0000-00000000c0c1';
