\set ON_ERROR_STOP on
\pset footer off
\echo '>>> Accounting contacts: one company per registrable domain; any subdomain matches'
reset role;
select set_config('request.jwt.claims', '', false) is not null as claims_cleared;
select public.accounting_company_domain('john@inform.bill.com') as a, public.accounting_company_domain('message.sce.com') as b, public.accounting_company_domain('x@bill.com') as c, public.accounting_company_domain('bob@gmail.com') as d;
select id as admin_id from public.profiles where organization_id = '00000000-0000-0000-0000-000000000001' and role = 'admin' and is_active order by created_at limit 1 \gset
update public.profiles set sees_accounting = true where id = :'admin_id';
insert into public.mailboxes (organization_id, kind, address, label, owner_id, gmail_box, auto_share_vendor_mail) values ('00000000-0000-0000-0000-000000000001', 'accounting', 'billing-d@example.com', 'Billing', :'admin_id', 'billing-d@example.com', false) returning id as mb \gset
insert into public.email_threads (organization_id, gmail_thread_id, mailbox_id, subject) values ('00000000-0000-0000-0000-000000000001', 'ad-t1', :'mb', 'Bill 1') returning id as t1 \gset
insert into public.email_threads (organization_id, gmail_thread_id, mailbox_id, subject) values ('00000000-0000-0000-0000-000000000001', 'ad-t2', :'mb', 'Bill 2') returning id as t2 \gset
insert into public.emails (organization_id, gmail_id, thread_id, direction, mailbox_id, gmail_box, from_email, from_name, to_emails, received_at)
  values ('00000000-0000-0000-0000-000000000001', 'ad-e1', :'t1', 'in', :'mb', 'billing-d@example.com', 'john@inform.billpay-test.com', 'John Burton', array['billing-d@example.com'], now() - interval '2 days');
insert into public.emails (organization_id, gmail_id, thread_id, direction, mailbox_id, gmail_box, from_email, from_name, to_emails, received_at)
  values ('00000000-0000-0000-0000-000000000001', 'ad-e2', :'t2', 'in', :'mb', 'billing-d@example.com', 'noreply@billpay-test.com', 'BILL', array['billing-d@example.com'], now() - interval '1 day');
select public.accounting_propose_contacts('00000000-0000-0000-0000-000000000001') as proposed_one_company;
select company, person, (select array_agg(address order by address) from public.accounting_contact_addresses a where a.contact_id = c.id) as addresses
  from public.accounting_contacts c where organization_id = '00000000-0000-0000-0000-000000000001';
select (select accounting_contact_id from public.email_threads where id = :'t1') = (select accounting_contact_id from public.email_threads where id = :'t2') as both_threads_same_contact,
       (select accounting_contact_id is not null from public.email_threads where id = :'t1') as matched;
-- a brand-new subdomain of the same company still lands on it
insert into public.email_threads (organization_id, gmail_thread_id, mailbox_id, subject) values ('00000000-0000-0000-0000-000000000001', 'ad-t3', :'mb', 'Bill 3') returning id as t3 \gset
insert into public.emails (organization_id, gmail_id, thread_id, direction, mailbox_id, gmail_box, from_email, from_name, to_emails, received_at)
  values ('00000000-0000-0000-0000-000000000001', 'ad-e3', :'t3', 'in', :'mb', 'billing-d@example.com', 'alerts@notify.billpay-test.com', 'BILL', array['billing-d@example.com'], now());
select (select accounting_contact_id from public.email_threads where id = :'t3') = (select accounting_contact_id from public.email_threads where id = :'t1') as subdomain_matched;
delete from public.mailboxes where id = :'mb';
delete from public.accounting_contacts where organization_id = '00000000-0000-0000-0000-000000000001';
