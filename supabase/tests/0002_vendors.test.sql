\set ON_ERROR_STOP on
\pset footer off
\echo '>>> vendors: seed terms present (expect 6, default Net 30)'
select count(*) as terms, (select name from public.payment_terms where is_default) as default_term from public.payment_terms;

\echo '>>> RLS as Dana (admin): create vendor, route, email, window, note, review item'
set role authenticated;
select set_config('request.jwt.claims', '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}', false);
insert into public.vendors (organization_id, name, lightspeed_name, aliases) values ('00000000-0000-0000-0000-000000000001', 'Stansport', 'STANSPORT - WWD', '{"STANSPORT - WWD"}') returning id as stansport \gset
insert into public.vendor_billing_routes (vendor_id, route, is_default) values (:'stansport', 'worldwide', true) returning organization_id is not null as org_filled;
insert into public.vendor_emails (vendor_id, email, contact_name, contact_type, source) values (:'stansport', 'rep@stansport.example', 'Pat Rep', 'rep', 'import') returning organization_id is not null as org_filled;
insert into public.vendor_order_windows (vendor_id, kind, months, label) values (:'stansport', 'feb_show', '{2}', 'February show') returning months;
insert into public.notes (organization_id, entity_type, entity_id, body, created_by) values ('00000000-0000-0000-0000-000000000001', 'vendor', :'stansport', 'first note', '11111111-1111-1111-1111-111111111111') returning body;
insert into public.review_items (organization_id, kind, entity_type, entity_id, title) values ('00000000-0000-0000-0000-000000000001', 'vendor_duplicate', 'vendor', :'stansport', 'Possible duplicate') returning status;
\echo '>>> Dana: duplicate name (case-insensitive) must FAIL; cross-tenant route must FAIL'
\set ON_ERROR_STOP off
insert into public.vendors (organization_id, name) values ('00000000-0000-0000-0000-000000000001', 'stansport');
insert into public.vendor_billing_routes (organization_id, vendor_id, route) values ('00000000-0000-0000-0000-000000000002', :'stansport', 'faire');
\set ON_ERROR_STOP on

\echo '>>> RLS as JW (buyer): can read and add a vendor; cannot add payment terms'
select set_config('request.jwt.claims', '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}', false);
select count(*) as vendors_visible from public.vendors;
insert into public.vendors (organization_id, name) values ('00000000-0000-0000-0000-000000000001', 'World Famous Sports') returning name;
\set ON_ERROR_STOP off
insert into public.payment_terms (organization_id, name, days_until_due) values ('00000000-0000-0000-0000-000000000001', 'Net 90', 90);
\set ON_ERROR_STOP on

\echo '>>> RLS as evil (viewer): can read, cannot write (expect RLS error)'
select set_config('request.jwt.claims', '{"sub":"44444444-4444-4444-4444-444444444444","role":"authenticated"}', false);
select count(*) as vendors_visible from public.vendors;
\set ON_ERROR_STOP off
insert into public.vendors (organization_id, name) values ('00000000-0000-0000-0000-000000000001', 'Sneaky Vendor');
update public.vendors set notes = 'hacked' where id = :'stansport';
\set ON_ERROR_STOP on

\echo '>>> RLS as other-org owner: sees none of org1 vendors, terms or review items (expect 0 / 0 / 0)'
select set_config('request.jwt.claims', '{"sub":"55555555-5555-5555-5555-555555555555","role":"authenticated"}', false);
select count(*) as vendors from public.vendors;
select count(*) as terms from public.payment_terms;
select count(*) as reviews from public.review_items;
reset role;
\echo '>>> policy inventory (new tables)'
select tablename, count(*) as policies from pg_policies where schemaname='public' and tablename in ('vendors','vendor_emails','vendor_billing_routes','payment_terms','review_items','notes','activity_log') group by 1 order by 1;
