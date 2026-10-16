\set ON_ERROR_STOP on
\pset footer off
\echo '>>> A rep typed on a rep-group vendor moves onto the rep group once; known-domain people count as theirs'
reset role;
select set_config('request.jwt.claims', '', false) is not null as service;
insert into public.rep_groups (organization_id, name) values ('00000000-0000-0000-0000-000000000001', 'JRA Test Sales') returning id as g \gset
insert into public.vendors (organization_id, name, rep_group_id) values ('00000000-0000-0000-0000-000000000001', 'Pure Test Fishing', :'g') returning id as v1 \gset
insert into public.vendors (organization_id, name, rep_group_id) values ('00000000-0000-0000-0000-000000000001', 'Other Test Line', :'g') returning id as v2 \gset
insert into public.vendor_emails (organization_id, vendor_id, email, contact_name, contact_type, roles, source)
values ('00000000-0000-0000-0000-000000000001', :'v1', 'old@jratest.com', 'Old Rep', 'rep', '{rep}', 'import');
insert into public.vendor_emails (organization_id, vendor_id, email, contact_name, contact_type, roles, source, phones)
values ('00000000-0000-0000-0000-000000000001', :'v1', 'travis@jratest.com', 'Travis', 'rep', '{rep}', 'manual', '[{"type":"cell","number":"209-604-3430"}]') returning id as t1 \gset
insert into public.vendor_emails (organization_id, vendor_id, email, contact_name, contact_type, roles, source)
values ('00000000-0000-0000-0000-000000000001', :'v2', 'Travis@jratest.com', 'Travis A', 'rep', '{rep}', 'manual') returning id as t2 \gset
update public.vendors set assigned_rep_contact_id = :'t2' where id = :'v2';
-- the domain rule: another JRA person is on a group vendor; gmail never counts
select public.contact_domain_known('new@jratest.com', null, :'g') as jra_domain_known,
       public.contact_domain_known('someone@gmail.com', :'v1', :'g') as gmail_not_known,
       public.contact_domain_known('x@elsewhere.com', :'v1', :'g') as other_not_known;
set role authenticated;
select set_config('request.jwt.claims', '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}', false) is not null as admin_in;
select public.vendor_contact_to_rep_group(:'t1') is not null as moved;
reset role;
select set_config('request.jwt.claims', '', false) is not null as service;
select count(*) as group_people, min(name) as name, min(phones::text) as phones from public.rep_group_contacts where rep_group_id = :'g';
select count(*) as travis_vendor_cards_left from public.vendor_emails where lower(email) = 'travis@jratest.com';
select assigned_rep_contact_id is null and assigned_rep_group_contact_id is not null as v2_main_rep_kept from public.vendors where id = :'v2';
-- moving again folds into the same person
insert into public.vendor_emails (organization_id, vendor_id, email, contact_name, contact_type, roles, source)
values ('00000000-0000-0000-0000-000000000001', :'v1', 'travis@jratest.com', 'Travis', 'rep', '{rep}', 'manual') returning id as t3 \gset
select public.vendor_contact_to_rep_group(:'t3') is not null as moved_again;
select count(*) as still_one_person from public.rep_group_contacts where rep_group_id = :'g';
-- cost log: one row per Claude call id
insert into public.ai_usage (organization_id, purpose, model, request_id) values ('00000000-0000-0000-0000-000000000001', 'not_logged', 'claude-haiku-5-5', 'msg_test_1');
insert into public.ai_usage (organization_id, purpose, model, request_id) values ('00000000-0000-0000-0000-000000000001', 'mail_sort', 'claude-haiku-5-5', 'msg_test_1')
  on conflict (request_id) do update set purpose = excluded.purpose;
select count(*) as one_row, min(purpose) as purpose from public.ai_usage where request_id = 'msg_test_1';
delete from public.ai_usage where request_id = 'msg_test_1';
update public.vendors set assigned_rep_contact_id = null, assigned_rep_group_contact_id = null where id in (:'v1', :'v2');
delete from public.vendor_emails where vendor_id in (:'v1', :'v2');
delete from public.vendors where id in (:'v1', :'v2');
delete from public.rep_group_contacts where rep_group_id = :'g';
delete from public.rep_groups where id = :'g';
