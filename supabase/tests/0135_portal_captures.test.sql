\set ON_ERROR_STOP on
\pset footer off
\echo '>>> Portal pages: the admin gets a bookmark key and can upload a saved page; others cannot'
reset role;
set role authenticated;
select set_config('request.jwt.claims', '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}', false) is not null as admin_in;
select public.portal_capture_key() = public.portal_capture_key() as same_key_each_time;
select public.portal_capture_upload('', 'Vendors.html', '<html><body>Vendors</body></html>') is not null as uploaded;
select count(*) as admin_sees from public.portal_captures;
reset role;
select set_config('request.jwt.claims', '', false) is not null as service;
delete from public.portal_captures;
delete from public.capture_keys;
