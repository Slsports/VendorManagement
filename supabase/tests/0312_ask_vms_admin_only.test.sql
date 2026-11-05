\set ON_ERROR_STOP on
\pset footer off
\echo '>>> 0312: only the admin turns Ask VMS on'
reset role;
select set_config('request.jwt.claims', '', false) is not null as service;
select id as buyer from public.profiles where role <> 'admin' and organization_id = '00000000-0000-0000-0000-000000000001' and is_active order by email limit 1 \gset
select id as admin from public.profiles where role = 'admin' and organization_id = '00000000-0000-0000-0000-000000000001' limit 1 \gset
select set_config('request.jwt.claims', json_build_object('sub', :'buyer', 'role', 'authenticated')::text, false) is not null as as_buyer;
set role authenticated;
do $$ begin
  update public.profiles set ask_vms = true where id = auth.uid();
  raise exception 'a buyer turned on their own Ask VMS';
exception when insufficient_privilege then null; end $$;
select 'buyer cannot tick themselves' as ok;
reset role;
select set_config('request.jwt.claims', json_build_object('sub', :'admin', 'role', 'authenticated')::text, false) is not null as as_admin;
set role authenticated;
update public.profiles set ask_vms = true where id = :'buyer';
reset role;
select ask_vms as admin_ticked from public.profiles where id = :'buyer';
update public.profiles set ask_vms = false where id = :'buyer';
