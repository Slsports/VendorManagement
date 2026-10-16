\set ON_ERROR_STOP on
\pset footer off
\echo '>>> Accounting contacts: proposed from billing@ mail by company, conversations matched, merge, private to the tick'
reset role;
select set_config('request.jwt.claims', '', false) is not null as claims_cleared;
select id as admin_id from public.profiles where organization_id = '00000000-0000-0000-0000-000000000001' and role = 'admin' and is_active order by created_at limit 1 \gset
update public.profiles set sees_accounting = true where id = :'admin_id';
update public.organizations set own_addresses = array['billing.slsports@example.net'] where id = '00000000-0000-0000-0000-000000000001';
insert into public.mailboxes (organization_id, kind, address, label, owner_id, gmail_box, auto_share_vendor_mail) values ('00000000-0000-0000-0000-000000000001', 'accounting', 'billing-c@example.com', 'Billing', :'admin_id', 'billing-c@example.com', false) returning id as mb \gset
insert into public.email_threads (organization_id, gmail_thread_id, mailbox_id, subject) values ('00000000-0000-0000-0000-000000000001', 'ac-t1', :'mb', 'Q3 books') returning id as t1 \gset
insert into public.email_threads (organization_id, gmail_thread_id, mailbox_id, subject) values ('00000000-0000-0000-0000-000000000001', 'ac-t2', :'mb', 'Policy renewal') returning id as t2 \gset
insert into public.email_threads (organization_id, gmail_thread_id, mailbox_id, subject) values ('00000000-0000-0000-0000-000000000001', 'ac-t3', :'mb', 'Newsletter') returning id as t3 \gset
insert into public.email_threads (organization_id, gmail_thread_id, mailbox_id, subject) values ('00000000-0000-0000-0000-000000000001', 'ac-t4', :'mb', 'From my old gmail') returning id as t4 \gset
-- the CPA firm: two people at one domain
insert into public.emails (organization_id, gmail_id, thread_id, direction, mailbox_id, gmail_box, from_email, from_name, to_emails, received_at)
  values ('00000000-0000-0000-0000-000000000001', 'ac-e1', :'t1', 'in', :'mb', 'billing-c@example.com', 'Lisa@MBSAccountancy.com', 'Lisa Larsen', array['billing-c@example.com'], now() - interval '3 days');
insert into public.emails (organization_id, gmail_id, thread_id, direction, mailbox_id, gmail_box, from_email, from_name, to_emails, received_at)
  values ('00000000-0000-0000-0000-000000000001', 'ac-e2', :'t1', 'in', :'mb', 'billing-c@example.com', 'nawal@mbsaccountancy.com', 'Nawal Hussein', array['billing-c@example.com'], now() - interval '2 days');
-- an insurance agent at Gmail: one in, one out
insert into public.emails (organization_id, gmail_id, thread_id, direction, mailbox_id, gmail_box, from_email, from_name, to_emails, received_at)
  values ('00000000-0000-0000-0000-000000000001', 'ac-e3', :'t2', 'in', :'mb', 'billing-c@example.com', 'agentbob@gmail.com', 'Bob Agent', array['billing-c@example.com'], now() - interval '5 days');
insert into public.emails (organization_id, gmail_id, thread_id, direction, mailbox_id, gmail_box, from_email, from_name, to_emails, received_at)
  values ('00000000-0000-0000-0000-000000000001', 'ac-e4', :'t2', 'out', :'mb', 'billing-c@example.com', 'billing-c@example.com', 'Dana', array['agentbob@gmail.com'], now() - interval '1 day');
-- newsletters only: never proposed
insert into public.emails (organization_id, gmail_id, thread_id, direction, mailbox_id, gmail_box, from_email, from_name, to_emails, received_at, is_bulk)
  values ('00000000-0000-0000-0000-000000000001', 'ac-e5', :'t3', 'in', :'mb', 'billing-c@example.com', 'promo@deals.example.org', 'Deals', array['billing-c@example.com'], now(), true);
insert into public.emails (organization_id, gmail_id, thread_id, direction, mailbox_id, gmail_box, from_email, from_name, to_emails, received_at, is_bulk)
  values ('00000000-0000-0000-0000-000000000001', 'ac-e6', :'t3', 'in', :'mb', 'billing-c@example.com', 'promo@deals.example.org', 'Deals', array['billing-c@example.com'], now(), true);
-- our own old address: never a contact
insert into public.emails (organization_id, gmail_id, thread_id, direction, mailbox_id, gmail_box, from_email, from_name, to_emails, received_at)
  values ('00000000-0000-0000-0000-000000000001', 'ac-e7', :'t4', 'in', :'mb', 'billing-c@example.com', 'billing.slsports@example.net', 'Dana', array['billing-c@example.com'], now());
insert into public.emails (organization_id, gmail_id, thread_id, direction, mailbox_id, gmail_box, from_email, from_name, to_emails, received_at)
  values ('00000000-0000-0000-0000-000000000001', 'ac-e8', :'t4', 'in', :'mb', 'billing-c@example.com', 'billing.slsports@example.net', 'Dana', array['billing-c@example.com'], now());

set role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', :'admin_id', 'role', 'authenticated')::text, false) is not null as as_admin;
select public.accounting_propose_contacts('00000000-0000-0000-0000-000000000001') as proposed;
select company, person, status, message_count, (select array_agg(address order by address) from public.accounting_contact_addresses a where a.contact_id = c.id) as addresses
  from public.accounting_contacts c where organization_id = '00000000-0000-0000-0000-000000000001' order by company, person;
select (select accounting_contact_id is not null from public.email_threads where id = :'t1') as cpa_thread_matched,
       (select accounting_contact_id is not null from public.email_threads where id = :'t2') as agent_thread_matched,
       (select accounting_contact_id is null from public.email_threads where id = :'t3') as newsletter_unmatched,
       (select accounting_contact_id is null from public.email_threads where id = :'t4') as own_address_unmatched;
select public.accounting_propose_contacts('00000000-0000-0000-0000-000000000001') as proposed_again_is_zero;
-- confirm the CPA firm with its category; mail follows the contact's category
select id as cpa from public.accounting_contacts where organization_id = '00000000-0000-0000-0000-000000000001' and company ilike '%mbs%' \gset
update public.accounting_contacts set status = 'confirmed', category = 'accounting_firm', company = 'MBS Accountancy' where id = :'cpa';
select c.category from public.email_threads t join public.accounting_contacts c on c.id = t.accounting_contact_id where t.id = :'t1';
-- a new email from the firm's domain lands on the contact as it arrives
reset role;
select set_config('request.jwt.claims', '', false) is not null as claims_cleared_1b;
insert into public.email_threads (organization_id, gmail_thread_id, mailbox_id, subject) values ('00000000-0000-0000-0000-000000000001', 'ac-t5', :'mb', 'W-9') returning id as t5 \gset
insert into public.emails (organization_id, gmail_id, thread_id, direction, mailbox_id, gmail_box, from_email, from_name, to_emails, received_at)
  values ('00000000-0000-0000-0000-000000000001', 'ac-e9', :'t5', 'in', :'mb', 'billing-c@example.com', 'new.person@mbsaccountancy.com', 'New Person', array['billing-c@example.com'], now());
select accounting_contact_id = :'cpa' as new_mail_matched_on_arrival from public.email_threads where id = :'t5';
set role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', :'admin_id', 'role', 'authenticated')::text, false) is not null as as_admin_again;
-- merge the agent into the firm (silly, but exercises it)
select id as agent from public.accounting_contacts where organization_id = '00000000-0000-0000-0000-000000000001' and person = 'Bob Agent' \gset
select public.accounting_merge_contacts(:'agent', :'cpa');
select (select status = 'ignored' and merged_into = :'cpa' from public.accounting_contacts where id = :'agent') as agent_marked_merged,
       (select accounting_contact_id = :'cpa' from public.email_threads where id = :'t2') as agent_thread_moved,
       (select count(*) from public.accounting_contact_addresses where contact_id = :'cpa') as cpa_addresses;
select public.accounting_recount('00000000-0000-0000-0000-000000000001');
select message_count as cpa_messages from public.accounting_contacts where id = :'cpa';
-- someone without the tick sees nothing and cannot propose
reset role;
select set_config('request.jwt.claims', '', false) is not null as claims_cleared_2;
insert into auth.users (id, email) values ('88888888-2222-3333-4444-555555555555', 'acct-nobody@example.com') on conflict do nothing;
insert into public.profiles (id, organization_id, email, full_name, role, is_active) values ('88888888-2222-3333-4444-555555555555', '00000000-0000-0000-0000-000000000001', 'acct-nobody@example.com', 'Nobody Test', 'manager', true) on conflict (id) do update set role = 'manager', organization_id = excluded.organization_id, is_active = true, sees_accounting = false;
set role authenticated;
select set_config('request.jwt.claims', '{"sub":"88888888-2222-3333-4444-555555555555","role":"authenticated"}', false) is not null as as_nobody;
select count(*) as nobody_sees_contacts from public.accounting_contacts;
\set ON_ERROR_STOP off
\echo '--- proposing without the tick is refused (expect an error)'
select public.accounting_propose_contacts('00000000-0000-0000-0000-000000000001');
\set ON_ERROR_STOP on
reset role;
select set_config('request.jwt.claims', '', false) is not null as claims_cleared_3;
delete from public.mailboxes where id = :'mb';
delete from public.accounting_contacts where organization_id = '00000000-0000-0000-0000-000000000001';
delete from public.profiles where id = '88888888-2222-3333-4444-555555555555';
delete from auth.users where id = '88888888-2222-3333-4444-555555555555';
update public.organizations set own_addresses = '{}' where id = '00000000-0000-0000-0000-000000000001';
