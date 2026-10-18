\set ON_ERROR_STOP on
\pset footer off
\echo '>>> Lightspeed requested scope: the access asked for at Connect is kept until the sign-in completes'
reset role;
select set_config('request.jwt.claims', '', false) is not null as service;
insert into public.lightspeed_connections (organization_id, client_id, client_secret, oauth_scope) values ('00000000-0000-0000-0000-000000000001', 'cid2', 'secret', 'employee:all')
on conflict (organization_id) do update set client_id = excluded.client_id, oauth_scope = excluded.oauth_scope;
select oauth_scope, scope from public.lightspeed_connections where client_id = 'cid2';
update public.lightspeed_connections set scope = oauth_scope, oauth_scope = null where client_id = 'cid2';
select scope = 'employee:all' as full_access, oauth_scope is null as cleared from public.lightspeed_connections where client_id = 'cid2';
delete from public.lightspeed_connections where client_id = 'cid2';
