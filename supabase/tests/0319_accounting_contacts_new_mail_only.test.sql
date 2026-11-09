\set ON_ERROR_STOP on
\pset footer off
\echo '>>> Accounting contacts look only at what changed: new mail for new people, one contact''s conversations when it changes, full re-match all at once'
reset role;
select set_config('request.jwt.claims', '', false) is not null as claims_cleared;
select id as admin_id from public.profiles where organization_id = '00000000-0000-0000-0000-000000000001' and role = 'admin' and is_active order by created_at limit 1 \gset
update public.profiles set sees_accounting = true where id = :'admin_id';
insert into public.mailboxes (organization_id, kind, address, label, owner_id, gmail_box, auto_share_vendor_mail) values ('00000000-0000-0000-0000-000000000001', 'accounting', 'billing-n@example.com', 'Billing', :'admin_id', 'billing-n@example.com', false) returning id as mb \gset
insert into public.email_threads (organization_id, gmail_thread_id, mailbox_id, subject) values ('00000000-0000-0000-0000-000000000001', 'nm-t1', :'mb', 'Old statement') returning id as t1 \gset
insert into public.email_threads (organization_id, gmail_thread_id, mailbox_id, subject) values ('00000000-0000-0000-0000-000000000001', 'nm-t2', :'mb', 'Invoice') returning id as t2 \gset
-- mail that was already looked at a day ago: two from an old company
insert into public.emails (organization_id, gmail_id, thread_id, direction, mailbox_id, gmail_box, from_email, from_name, to_emails, received_at, created_at) values
  ('00000000-0000-0000-0000-000000000001', 'nm-e1', :'t1', 'in', :'mb', 'billing-n@example.com', 'ann@oldco-n.example', 'Ann Old', array['billing-n@example.com'], now() - interval '30 days', now() - interval '1 day'),
  ('00000000-0000-0000-0000-000000000001', 'nm-e2', :'t1', 'in', :'mb', 'billing-n@example.com', 'ann@oldco-n.example', 'Ann Old', array['billing-n@example.com'], now() - interval '29 days', now() - interval '1 day');
insert into public.accounting_propose_state (organization_id, checked_to) values ('00000000-0000-0000-0000-000000000001', now() - interval '1 hour')
  on conflict (organization_id) do update set checked_to = excluded.checked_to;
-- new mail: two from a new company
insert into public.emails (organization_id, gmail_id, thread_id, direction, mailbox_id, gmail_box, from_email, from_name, to_emails, received_at) values
  ('00000000-0000-0000-0000-000000000001', 'nm-e3', :'t2', 'in', :'mb', 'billing-n@example.com', 'bo@newco-n.example', 'Bo New', array['billing-n@example.com'], now() - interval '2 hours'),
  ('00000000-0000-0000-0000-000000000001', 'nm-e4', :'t2', 'in', :'mb', 'billing-n@example.com', 'bo@newco-n.example', 'Bo New', array['billing-n@example.com'], now() - interval '1 hour');

set role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', :'admin_id', 'role', 'authenticated')::text, false) is not null as as_admin;
select public.accounting_propose_contacts('00000000-0000-0000-0000-000000000001') >= 1 as proposed_new;
select exists (select 1 from public.accounting_contact_addresses where address = 'newco-n.example') as new_company_found,
       not exists (select 1 from public.accounting_contact_addresses where address = 'oldco-n.example') as old_mail_not_read_again,
       (select accounting_contact_id is not null from public.email_threads where id = :'t2') as new_thread_matched;
select checked_to > now() - interval '1 minute' as state_moved from public.accounting_propose_state where organization_id = '00000000-0000-0000-0000-000000000001';

-- one new email from the old company: now it is found, counted over all its mail (3), and its old conversation matched
reset role;
select set_config('request.jwt.claims', '', false) is not null as claims_cleared_1;
insert into public.emails (organization_id, gmail_id, thread_id, direction, mailbox_id, gmail_box, from_email, from_name, to_emails, received_at) values
  ('00000000-0000-0000-0000-000000000001', 'nm-e5', :'t1', 'in', :'mb', 'billing-n@example.com', 'ann@oldco-n.example', 'Ann Old', array['billing-n@example.com'], now());
set role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', :'admin_id', 'role', 'authenticated')::text, false) is not null as as_admin_1;
select public.accounting_propose_contacts('00000000-0000-0000-0000-000000000001') = 1 as old_company_found;
select c.message_count = 3 as counted_all_mail, t.accounting_contact_id = c.id as old_thread_matched
  from public.accounting_contact_addresses a join public.accounting_contacts c on c.id = a.contact_id, public.email_threads t
 where a.address = 'oldco-n.example' and t.id = :'t1';
select public.accounting_propose_contacts('00000000-0000-0000-0000-000000000001') = 0 as nothing_new;

-- ignore the new company: re-matching just that contact takes its conversation off it
select contact_id as newco from public.accounting_contact_addresses where address = 'newco-n.example' \gset
update public.accounting_contacts set status = 'ignored' where id = :'newco';
select public.accounting_rematch_contact(:'newco') >= 1 as rematched_one_contact;
select accounting_contact_id is null as ignored_thread_cleared from public.email_threads where id = :'t2';
update public.accounting_contacts set status = 'proposed' where id = :'newco';
select public.accounting_rematch_contact(:'newco') >= 1 as rematched_back;
select accounting_contact_id = :'newco' as back_on_contact from public.email_threads where id = :'t2';

-- the full re-match (back-checks) gives the same answers, all at once
reset role;
select set_config('request.jwt.claims', '', false) is not null as claims_cleared_2;
update public.email_threads set accounting_contact_id = null where id in (:'t1', :'t2');
set role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', :'admin_id', 'role', 'authenticated')::text, false) is not null as as_admin_2;
select public.accounting_rematch_all('00000000-0000-0000-0000-000000000001') >= 2 as rematch_all_ok;
select bool_and(accounting_contact_id is not null) as both_matched_again from public.email_threads where id in (:'t1', :'t2');
reset role;
select set_config('request.jwt.claims', '', false) is not null as claims_cleared_2b;
select bool_and(accounting_contact_id is not distinct from public.accounting_contact_for(organization_id, public.accounting_thread_counterpart(id))) as same_as_one_by_one
  from public.email_threads where mailbox_id = :'mb';

-- without the Accounting tick: refused
reset role;
select set_config('request.jwt.claims', '', false) is not null as claims_cleared_3;
insert into auth.users (id, email) values ('31931900-0000-0000-0000-000000000001', 'nm-nobody@example.com') on conflict do nothing;
insert into public.profiles (id, organization_id, email, full_name, role, is_active) values ('31931900-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001', 'nm-nobody@example.com', 'Nm Nobody', 'manager', true) on conflict (id) do nothing;
set role authenticated;
select set_config('request.jwt.claims', '{"sub":"31931900-0000-0000-0000-000000000001","role":"authenticated"}', false) is not null as as_nobody;
do $$ begin
  perform public.accounting_rematch_keys('00000000-0000-0000-0000-000000000001', array['newco-n.example']);
  raise exception 'no tick re-matched';
exception when insufficient_privilege then null; end $$;
select count(*) = 0 as nobody_sees_state from public.accounting_propose_state;
reset role;
select set_config('request.jwt.claims', '', false) is not null as claims_cleared_4;
delete from public.mailboxes where id = :'mb';
