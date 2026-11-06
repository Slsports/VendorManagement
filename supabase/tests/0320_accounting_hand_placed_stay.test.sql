\set ON_ERROR_STOP on
\pset footer off
\echo '>>> A billing@ conversation put on a contact by hand stays there; Let VMS match it undoes that'
reset role;
select set_config('request.jwt.claims', '', false) is not null as claims_cleared;
select id as admin_id from public.profiles where organization_id = '00000000-0000-0000-0000-000000000001' and role = 'admin' and is_active order by created_at limit 1 \gset
update public.profiles set sees_accounting = true where id = :'admin_id';
insert into public.mailboxes (organization_id, kind, address, label, owner_id, gmail_box, auto_share_vendor_mail) values ('00000000-0000-0000-0000-000000000001', 'accounting', 'billing-h@example.com', 'Billing', :'admin_id', 'billing-h@example.com', false) returning id as mb \gset
insert into public.accounting_contacts (organization_id, company, person) values ('00000000-0000-0000-0000-000000000001', 'Bank H', '') returning id as bank \gset
insert into public.accounting_contacts (organization_id, company, person) values ('00000000-0000-0000-0000-000000000001', 'CPA H', '') returning id as cpa \gset
insert into public.accounting_contact_addresses (organization_id, address, is_domain, contact_id) values ('00000000-0000-0000-0000-000000000001', 'bank-h.example', true, :'bank');
insert into public.email_threads (organization_id, gmail_thread_id, mailbox_id, subject) values ('00000000-0000-0000-0000-000000000001', 'hp-t1', :'mb', 'Statement') returning id as t1 \gset
insert into public.emails (organization_id, gmail_id, thread_id, direction, mailbox_id, gmail_box, from_email, to_emails, received_at)
  values ('00000000-0000-0000-0000-000000000001', 'hp-e1', :'t1', 'in', :'mb', 'billing-h@example.com', 'ann@bank-h.example', array['billing-h@example.com'], now() - interval '1 day');
select accounting_contact_id = :'bank' and not accounting_contact_by_hand as matched_by_address from public.email_threads where id = :'t1';

set role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', :'admin_id', 'role', 'authenticated')::text, false) is not null as as_admin;
select public.accounting_set_thread_contact(:'t1', :'cpa');
select accounting_contact_id = :'cpa' and accounting_contact_by_hand as placed_by_hand from public.email_threads where id = :'t1';
-- every automatic re-match leaves it alone
select public.accounting_rematch_all('00000000-0000-0000-0000-000000000001') is not null as full_rematch;
select public.accounting_rematch_contact(:'bank') is not null as contact_rematch;
reset role;
select set_config('request.jwt.claims', '', false) is not null as claims_cleared_1;
insert into public.emails (organization_id, gmail_id, thread_id, direction, mailbox_id, gmail_box, from_email, to_emails, received_at)
  values ('00000000-0000-0000-0000-000000000001', 'hp-e2', :'t1', 'in', :'mb', 'billing-h@example.com', 'bob@bank-h.example', array['billing-h@example.com'], now());
select accounting_contact_id = :'cpa' as stays_after_new_mail_and_rematches from public.email_threads where id = :'t1';
-- taken off by hand stays off too
set role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', :'admin_id', 'role', 'authenticated')::text, false) is not null as as_admin_1;
select public.accounting_set_thread_contact(:'t1', null);
select public.accounting_rematch_all('00000000-0000-0000-0000-000000000001') is not null as full_rematch_2;
select accounting_contact_id is null and accounting_contact_by_hand as off_stays_off from public.email_threads where id = :'t1';
-- Let VMS match it
select public.accounting_set_thread_contact(:'t1', null, true);
select accounting_contact_id = :'bank' and not accounting_contact_by_hand as back_to_automatic from public.email_threads where id = :'t1';
-- merging moves a hand-placed conversation to the merged contact
select public.accounting_set_thread_contact(:'t1', :'cpa');
select public.accounting_merge_contacts(:'cpa', :'bank');
select accounting_contact_id = :'bank' as merge_moves_it from public.email_threads where id = :'t1';
reset role;
select set_config('request.jwt.claims', '', false) is not null as claims_cleared_2;
delete from public.mailboxes where id = :'mb';
