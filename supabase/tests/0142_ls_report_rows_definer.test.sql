\set ON_ERROR_STOP on
\pset footer off
\echo '>>> ls_report_rows as definer: another organization is refused'
reset role;
select set_config('request.jwt.claims', '', false) is not null as claims_cleared;
select id as admin_id from public.profiles where organization_id = '00000000-0000-0000-0000-000000000001' and role = 'admin' and is_active order by created_at limit 1 \gset
set role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', :'admin_id', 'role', 'authenticated')::text, false) is not null as as_admin;
select count(*) as own_org_ok from public.ls_report_rows('00000000-0000-0000-0000-000000000001', current_date - 30, current_date, array['1'], null, null);
do $$ begin
  perform * from public.ls_report_rows('00000000-0000-0000-0000-000000000002', current_date - 30, current_date, array['1'], null, null);
  raise exception 'another organization was readable';
exception when insufficient_privilege then null; end $$;
reset role;
select set_config('request.jwt.claims', '', false) is not null as claims_cleared;
