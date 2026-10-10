\set ON_ERROR_STOP on
\pset footer off
\echo '>>> vendor contact emails: the three fields save, land in the contact list once, and a bad address is refused (expect 1 error)'
set role authenticated;
select set_config('request.jwt.claims', '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}', false);
insert into public.vendors (organization_id, name, email, rep_name, rep_email) values ('00000000-0000-0000-0000-000000000001', 'Email Field Test Co', 'Orders@EmailTest.com', 'Pat Rep', 'pat@reps.com') returning id as evid \gset
update public.vendors set shipping_contact = 'Sam Ship', shipping_contact_email = 'sam@emailtest.com' where id = :'evid';
update public.vendors set email = 'orders@emailtest.com' where id = :'evid';
select email, contact_type, contact_name from public.vendor_emails where vendor_id = :'evid' order by email;
\set ON_ERROR_STOP off
update public.vendors set rep_email = 'not-an-email' where id = :'evid';
\set ON_ERROR_STOP on
reset role;
