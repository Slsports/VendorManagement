\set ON_ERROR_STOP on
\pset footer off
\echo '>>> partners: buyer creates Worldwide with member number and contacts; viewer reads but cannot write (expect 1 error)'
set role authenticated;
select set_config('request.jwt.claims', '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}', false);
insert into public.partners (organization_id, route, name, member_number, main_phone) values ('00000000-0000-0000-0000-000000000001', 'worldwide', 'Worldwide Distributors', '816', '253-872-8746') returning id as wwd \gset
insert into public.partner_contacts (organization_id, partner_id, name, department, title, extension, email, member_range, show_on_vendor, sort_order)
  values ('00000000-0000-0000-0000-000000000001', :'wwd', 'Arsenia Miyaji', 'Accounts receivable', 'Cash Application & Claims Specialist', '339', 'arseniam@example.com', '763-893', true, 10) returning name;
\echo '>>> same email twice must FAIL'
\set ON_ERROR_STOP off
insert into public.partner_contacts (organization_id, partner_id, name, email) values ('00000000-0000-0000-0000-000000000001', :'wwd', 'Dup', 'ArseniaM@example.com');
\set ON_ERROR_STOP on
select set_config('request.jwt.claims', '{"sub":"44444444-4444-4444-4444-444444444444","role":"authenticated"}', false);
select count(*) as viewer_sees from public.partner_contacts where partner_id = :'wwd';
\set ON_ERROR_STOP off
update public.partners set main_phone = 'x' where id = :'wwd';
\set ON_ERROR_STOP on
select main_phone from public.partners where id = :'wwd';
reset role;
