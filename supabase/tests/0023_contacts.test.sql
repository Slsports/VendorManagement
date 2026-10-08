\set ON_ERROR_STOP on
\pset footer off
\echo '>>> a rep group holds several people; mail from any of their addresses is that rep group'
reset role;
select set_config('request.jwt.claims', '', false) is not null as as_service;
insert into public.rep_groups (organization_id, name, email, contact_name) values ('00000000-0000-0000-0000-000000000001', 'Contacts Test Lines', 'donnah@diversetest.com', 'Donna') returning id as cg \gset
insert into public.vendors (organization_id, name, rep_group_id) values ('00000000-0000-0000-0000-000000000001', 'Contacts Test Vendor', :'cg') returning id as cv \gset
insert into public.email_senders (organization_id, sender_key, is_domain) values ('00000000-0000-0000-0000-000000000001', 'dandytestllc.com', true) returning id as cs \gset
set role authenticated;
select set_config('request.jwt.claims', '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}', false);
insert into public.rep_group_contacts (rep_group_id, name, email) values (:'cg', 'Donna (second address)', 'donna@dandytestllc.com') returning organization_id = '00000000-0000-0000-0000-000000000001'::uuid as org_filled;
insert into public.rep_group_contacts (rep_group_id, name, phone) values (:'cg', 'Show rep Bob', '555-1212');
select count(*) as people from public.rep_group_contacts where rep_group_id = :'cg';
reset role;
select kind, rep_group_id = :'cg' as is_group from public.email_senders where id = :'cs';
\echo '>>> a vendor contact can be phone-only; one assigned rep at a time (expect 1 error); orders record who took them'
set role authenticated;
insert into public.vendor_emails (vendor_id, organization_id, contact_name, phone, contact_type) values (:'cv', '00000000-0000-0000-0000-000000000001', 'Show rep Sue', '555-3434', 'rep') returning id as vc \gset
update public.vendors set assigned_rep_contact_id = :'vc' where id = :'cv' returning assigned_rep_contact_id is not null as starred;
\set ON_ERROR_STOP off
update public.vendors set assigned_rep_group_contact_id = (select id from public.rep_group_contacts where rep_group_id = :'cg' limit 1) where id = :'cv';
\set ON_ERROR_STOP on
insert into public.orders (organization_id, vendor_id, taken_by) values ('00000000-0000-0000-0000-000000000001', :'cv', 'Show rep Bob') returning taken_by;
reset role;
\echo '>>> a web address that contains a rep group name is that rep group (dandylinesllc.com → DandyLines)'
reset role;
select set_config('request.jwt.claims', '', false) is not null as as_service;
select public.mail_name_keys('DandyLines / Diverse Marketing') as keys, public.mail_domain_label('mail.dandylinesllc.com') as label;
insert into public.rep_groups (organization_id, name) values ('00000000-0000-0000-0000-000000000001', 'Zorbex Lines / Diverse Test Marketing') returning id as dg \gset
insert into public.email_senders (organization_id, sender_key, is_domain) values ('00000000-0000-0000-0000-000000000001', 'zorbexlinesllc.com', true) returning id as ds, cardinality(domain_rep_group_ids) as groups_found \gset
select public.mail_match_rep_senders('00000000-0000-0000-0000-000000000001', array[:'ds']::uuid[]) as matched;
select kind, rep_group_id = :'dg' as is_zorbex from public.email_senders where id = :'ds';
insert into public.email_senders (organization_id, sender_key, is_domain) values ('00000000-0000-0000-0000-000000000001', 'gmail.com', true) returning cardinality(domain_rep_group_ids) as freemail_groups;
