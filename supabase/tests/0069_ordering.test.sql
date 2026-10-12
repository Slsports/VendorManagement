\set ON_ERROR_STOP on
\pset footer off
\echo '>>> Ordering flags: one open flag per vendor, editors only, done stamps who and when'
reset role;
select id as admin_id from public.profiles where organization_id = '00000000-0000-0000-0000-000000000001' and role = 'admin' and is_active order by created_at limit 1 \gset
insert into public.vendors (organization_id, name) values ('00000000-0000-0000-0000-000000000001', 'Ordering Test Vendor') returning id as v \gset
set role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', :'admin_id', 'role', 'authenticated')::text, false) is not null as as_admin;
insert into public.ordering_items (organization_id, vendor_id, stage) values ('00000000-0000-0000-0000-000000000001', :'v', 'check') returning id as f, flagged_by = :'admin_id' as flagged_by_me \gset
select :'flagged_by_me' as flagged_by_me;
\set ON_ERROR_STOP off
insert into public.ordering_items (organization_id, vendor_id, stage) values ('00000000-0000-0000-0000-000000000001', :'v', 'to_order');
\set ON_ERROR_STOP on
insert into public.sales_reports (organization_id, vendor_id, items) values ('00000000-0000-0000-0000-000000000001', :'v', '[{"vid":"626","need":4}]') returning id as r \gset
update public.ordering_items set stage = 'to_order', report_id = :'r' where id = :'f';
update public.ordering_items set stage = 'done', outcome = 'ordered' where id = :'f';
select done_at is not null as done_stamped, done_by = :'admin_id' as done_by_me from public.ordering_items where id = :'f';
insert into public.ordering_items (organization_id, vendor_id, stage) values ('00000000-0000-0000-0000-000000000001', :'v', 'check') returning stage as new_flag_after_done;
reset role;
delete from public.ordering_items where vendor_id = :'v';
delete from public.sales_reports where vendor_id = :'v';
delete from public.vendors where id = :'v';
