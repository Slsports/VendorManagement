\set ON_ERROR_STOP on
\pset footer off
\echo '>>> Our own addresses are never a vendor or rep group contact'
reset role;
select set_config('request.jwt.claims', '', false) is not null as service;
select public.is_our_address('00000000-0000-0000-0000-000000000001', (select email from public.profiles where id = '11111111-1111-1111-1111-111111111111')) as staff_login_is_ours;
select not public.is_our_address('00000000-0000-0000-0000-000000000001', 'rep@oa229reps.test') as a_rep_is_not;
select not public.is_our_address('00000000-0000-0000-0000-000000000001', '') and not public.is_our_address('00000000-0000-0000-0000-000000000001', null) as blank_is_not;
update public.organizations set own_addresses = coalesce(own_addresses, '{}') || array['oa229-owner@gmail.test'] where id = '00000000-0000-0000-0000-000000000001';
select public.is_our_address('00000000-0000-0000-0000-000000000001', 'OA229-Owner@gmail.test') as own_address_is_ours;
-- filing a rep sender: the rep becomes a contact, a forwarded copy from our own address does not
insert into public.rep_groups (organization_id, name) values ('00000000-0000-0000-0000-000000000001', 'OA229 Reps') returning id as g \gset
insert into public.email_senders (organization_id, sender_key, is_domain) values ('00000000-0000-0000-0000-000000000001', 'oa229reps.test', true) returning id as s \gset
insert into public.email_threads (organization_id, gmail_thread_id, subject, last_message_at) values ('00000000-0000-0000-0000-000000000001', 'oa229', 'x', now()) returning id as t \gset
insert into public.emails (organization_id, thread_id, gmail_id, sender_id, direction, from_email, from_name, subject, received_at) values
  ('00000000-0000-0000-0000-000000000001', :'t', 'oa229-1', :'s', 'in', 'rep@oa229reps.test', 'Rep Person', 'Order', now()),
  ('00000000-0000-0000-0000-000000000001', :'t', 'oa229-2', :'s', 'in', 'oa229-owner@gmail.test', 'Dana Fwd', 'Fw: Order', now());
select count(*) = 1 as filed from (select public.rep_group_file_sender(:'s', :'g', 'test', null)) x;
select count(*) = 1 and bool_and(email = 'rep@oa229reps.test') as only_the_rep_saved from public.rep_group_contacts where rep_group_id = :'g';
-- back-check: our address saved by mistake is deleted
insert into public.rep_group_contacts (organization_id, rep_group_id, name, email) values ('00000000-0000-0000-0000-000000000001', :'g', 'Oops', 'oa229-owner@gmail.test');
delete from public.rep_group_contacts c where public.is_our_address(c.organization_id, c.email) and c.rep_group_id = :'g';
select count(*) = 1 as cleaned from public.rep_group_contacts where rep_group_id = :'g';
delete from public.emails where thread_id = :'t';
delete from public.email_threads where id = :'t';
delete from public.email_senders where id = :'s';
delete from public.rep_group_contacts where rep_group_id = :'g';
delete from public.rep_groups where id = :'g';
update public.organizations set own_addresses = array_remove(own_addresses, 'oa229-owner@gmail.test') where id = '00000000-0000-0000-0000-000000000001';
