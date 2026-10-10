\set ON_ERROR_STOP on
\pset footer off
\echo '>>> seed'
select id as gs_id from public.stores where code='GS' \gset
select code, name, aliases from public.stores order by sort_order;
select name, slug, accent_color from public.organizations;

\echo '>>> create users via auth.users (trigger). Expect: dana=admin (first), jw=buyer w/ SLS+SLH, tj=viewer, evil=viewer (forged user_metadata ignored)'
insert into auth.users (id, email, raw_user_meta_data) values ('11111111-1111-1111-1111-111111111111', 'dana@example.com', '{"full_name":"Dana Powell"}');
insert into auth.users (id, email, raw_app_meta_data, raw_user_meta_data) values ('22222222-2222-2222-2222-222222222222', 'jw@example.com', '{"role":"buyer","store_codes":["SLS","slh"]}', '{"full_name":"Jarrett W"}');
insert into auth.users (id, email, raw_user_meta_data) values ('33333333-3333-3333-3333-333333333333', 'tj@example.com', '{"full_name":"Trevor"}');
insert into auth.users (id, email, raw_user_meta_data) values ('44444444-4444-4444-4444-444444444444', 'evil@example.com', '{"role":"admin","full_name":"Forger"}');
select email, full_name, role, organization_id from public.profiles order by email;
select p.email, s.code from public.user_store_access usa join public.profiles p on p.id=usa.user_id join public.stores s on s.id=usa.store_id order by 1,2;

\echo '>>> second tenant. Expect owner@other = admin of org 2'
insert into public.organizations (id, name, slug) values ('00000000-0000-0000-0000-000000000002','Other Retail','other');
insert into public.stores (organization_id, code, name) values ('00000000-0000-0000-0000-000000000002','OR1','Other Store 1');
insert into auth.users (id, email, raw_app_meta_data) values ('55555555-5555-5555-5555-555555555555', 'owner@other.com', '{"organization_id":"00000000-0000-0000-0000-000000000002"}');
select email, role, organization_id from public.profiles where email='owner@other.com';

\echo '>>> RLS as Dana (admin, org1). Expect is_admin=t, stores=4, profiles=4, orgs=1, org update 1 row, tj->buyer ok, grant SLM to tj ok'
set role authenticated;
select set_config('request.jwt.claims', '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}', false);
select public.is_admin() as is_admin, public.current_user_org() as org, public.current_user_role() as role;
select count(*) as stores_visible from public.stores;
select count(*) as profiles_visible from public.profiles;
select count(*) as orgs_visible from public.organizations;
update public.organizations set accent_color='#123456' where id='00000000-0000-0000-0000-000000000001' returning accent_color;
update public.profiles set role='buyer' where email='tj@example.com' returning email, role;
insert into public.user_store_access (user_id, store_id) select '33333333-3333-3333-3333-333333333333', id from public.stores where code='SLM' returning store_id is not null as granted;
\echo '>>> Dana: next 3 statements must FAIL (own role change / cross-tenant store insert / cross-tenant grant)'
\set ON_ERROR_STOP off
update public.profiles set role='viewer' where id='11111111-1111-1111-1111-111111111111';
insert into public.stores (organization_id, code, name) values ('00000000-0000-0000-0000-000000000002','X1','Cross-tenant');
insert into public.user_store_access (user_id, store_id) select '55555555-5555-5555-5555-555555555555', id from public.stores where code='SLS';
\set ON_ERROR_STOP on
\echo '>>> Dana: org-2 rows must be invisible (expect 0 / 0)'
select count(*) as other_org_stores from public.stores where organization_id='00000000-0000-0000-0000-000000000002';
select count(*) as other_org_profiles from public.profiles where organization_id='00000000-0000-0000-0000-000000000002';

\echo '>>> RLS as JW (buyer). Expect stores SLH,SLS; profiles=4; own name update ok; org update 0 rows'
select set_config('request.jwt.claims', '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}', false);
select code from public.stores order by code;
select count(*) as profiles_visible from public.profiles;
update public.profiles set full_name='Jarrett Williams' where id='22222222-2222-2222-2222-222222222222' returning full_name;
update public.organizations set name='hacked' where id='00000000-0000-0000-0000-000000000001';
\echo '>>> JW: self-promotion must FAIL; editing tj must affect 0 rows; self-granting GS must FAIL'
\set ON_ERROR_STOP off
update public.profiles set role='admin' where id='22222222-2222-2222-2222-222222222222';
update public.profiles set full_name='x' where id='33333333-3333-3333-3333-333333333333';
insert into public.user_store_access (user_id, store_id) values ('22222222-2222-2222-2222-222222222222', :'gs_id');
\set ON_ERROR_STOP on

\echo '>>> RLS as TJ. Expect stores: SLM only; access rows: 1'
select set_config('request.jwt.claims', '{"sub":"33333333-3333-3333-3333-333333333333","role":"authenticated"}', false);
select code from public.stores order by code;
select count(*) as my_access_rows from public.user_store_access;

\echo '>>> RLS as evil (viewer, no grants). Expect 0 stores, role viewer'
select set_config('request.jwt.claims', '{"sub":"44444444-4444-4444-4444-444444444444","role":"authenticated"}', false);
select count(*) as stores_visible from public.stores;
select role from public.profiles where id = auth.uid();

\echo '>>> RLS as other-org owner. Expect OR1 / Other Retail / only owner@other.com'
select set_config('request.jwt.claims', '{"sub":"55555555-5555-5555-5555-555555555555","role":"authenticated"}', false);
select code from public.stores;
select name from public.organizations;
select email from public.profiles;

\echo '>>> anon: must be permission denied'
reset role;
set role anon;
\set ON_ERROR_STOP off
select count(*) from public.stores;
select public.is_admin();
\set ON_ERROR_STOP on
reset role;

\echo '>>> email sync + policy inventory'
update auth.users set email='dana.powell@example.com' where id='11111111-1111-1111-1111-111111111111';
select email from public.profiles where id='11111111-1111-1111-1111-111111111111';
select tablename, count(*) as policies from pg_policies where schemaname='public' group by 1 order by 1;
select relname, relrowsecurity from pg_class where relnamespace='public'::regnamespace and relkind='r' order by 1;
