\set ON_ERROR_STOP on
\pset footer off
\echo '>>> Contact filing: skip takes filed papers back out with the note; file looks at the emails again'
reset role;
select set_config('request.jwt.claims', '', false) is not null as claims_cleared;
select id as admin_id from public.profiles where organization_id = '00000000-0000-0000-0000-000000000001' and role = 'admin' and is_active order by created_at limit 1 \gset
update public.profiles set sees_accounting = true where id = :'admin_id';
insert into public.mailboxes (organization_id, kind, address, label, owner_id, gmail_box, auto_share_vendor_mail) values ('00000000-0000-0000-0000-000000000001', 'accounting', 'billing-filing@example.com', 'Billing', :'admin_id', 'billing-filing@example.com', false) returning id as mb \gset
insert into public.accounting_contacts (organization_id, company, category, status, filing, filing_note) values ('00000000-0000-0000-0000-000000000001', 'Emery Jensen', 'bills', 'confirmed', 'skip', 'handled in bill.com') returning id as ej \gset
-- the thread's contact is set from the sender's address when mail arrives, so the contact needs the domain
insert into public.accounting_contact_addresses (organization_id, address, is_domain, contact_id) values ('00000000-0000-0000-0000-000000000001', 'emeryjensen.com', true, :'ej');
insert into public.email_threads (organization_id, gmail_thread_id, mailbox_id, accounting_contact_id) values ('00000000-0000-0000-0000-000000000001', 'ej-thread-1', :'mb', :'ej') returning id as th \gset
insert into public.emails (organization_id, gmail_id, thread_id, direction, from_email, subject, received_at, has_attachments, mailbox_id, accounting_filed_at)
  values ('00000000-0000-0000-0000-000000000001', 'ej-mail-1', :'th', 'in', 'noreply@emeryjensen.com', 'Invoice 1', now(), true, :'mb', now()) returning id as em \gset
insert into public.email_attachments (organization_id, email_id, file_name, mime_type, size, gmail_attachment_id) values ('00000000-0000-0000-0000-000000000001', :'em', 'inv.pdf', 'application/pdf', 100, 'g1') returning id as att \gset
insert into public.accounting_documents (organization_id, category, party, doc_year, file_name, storage_path, sha256, email_id, attachment_id)
  values ('00000000-0000-0000-0000-000000000001', 'bills', 'Emery Jensen', 2026, 'x.pdf', '00000000-0000-0000-0000-000000000001/ej.pdf', 'ej-sha', :'em', :'att') returning id as doc \gset
update public.email_attachments set accounting_document_id = :'doc' where id = :'att';
insert into storage.objects (bucket_id, name) values ('accounting-files', '00000000-0000-0000-0000-000000000001/ej.pdf');
set role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', :'admin_id', 'role', 'authenticated')::text, false) is not null as as_admin;
select public.accounting_apply_contact_filing(:'ej') as paths_to_remove;
select (select count(*) from public.accounting_documents where id = :'doc') as doc_gone,
       (select accounting_skip from public.email_attachments where id = :'att') as attachment_note,
       (select count(*) from storage.objects where name = '00000000-0000-0000-0000-000000000001/ej.pdf') as file_row_left_for_the_api;
reset role;
select set_config('request.jwt.claims', '', false) is not null as claims_cleared;
update public.accounting_contacts set filing = 'file' where id = :'ej';
select public.accounting_apply_contact_filing(:'ej') as no_paths_when_filing_again;
select accounting_filed_at is null as queued_again from public.emails where id = :'em';
delete from storage.objects where name = '00000000-0000-0000-0000-000000000001/ej.pdf';
delete from public.email_threads where id = :'th';
delete from public.accounting_contacts where id = :'ej';
delete from public.mailboxes where id = :'mb';
