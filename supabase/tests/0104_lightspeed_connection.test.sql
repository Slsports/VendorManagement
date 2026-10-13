\set ON_ERROR_STOP off
\pset footer off
\echo '>>> Lightspeed keys: no signed-in user can read them (expect one permission denied)'
reset role;
select set_config('request.jwt.claims', '', false) is not null as service;
insert into public.lightspeed_connections (organization_id, client_id, client_secret) values ('00000000-0000-0000-0000-000000000001', 'cid', 'secret')
on conflict (organization_id) do update set client_id = excluded.client_id;
set role authenticated;
select set_config('request.jwt.claims', '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}', false) is not null as admin_signed_in;
select client_secret from public.lightspeed_connections;
reset role;
select set_config('request.jwt.claims', '', false) is not null as service;
delete from public.lightspeed_connections where client_id = 'cid';
\set ON_ERROR_STOP on
