\set ON_ERROR_STOP on
\pset footer off
\echo '>>> Dashboard layout saved on the profile'
reset role;
select id as admin_id from public.profiles where organization_id = '00000000-0000-0000-0000-000000000001' and role = 'admin' and is_active order by created_at limit 1 \gset
set role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', :'admin_id', 'role', 'authenticated')::text, false) is not null as as_admin;
update public.profiles set dashboard_layout = '{"order":["review","mail"],"hidden":["recent_activity"]}' where id = :'admin_id';
reset role;
select dashboard_layout->'order'->>0 as first_card from public.profiles where id = :'admin_id';
