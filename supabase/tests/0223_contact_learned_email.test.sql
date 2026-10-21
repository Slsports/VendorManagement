\set ON_ERROR_STOP on
\pset footer off
\echo '>>> Learned contacts keep the email they were learned from; deleting that email clears the link'
reset role;
select count(*) = 2 as both_columns from information_schema.columns
 where table_schema = 'public' and column_name = 'learned_email_id' and table_name in ('vendor_emails', 'rep_group_contacts');
insert into public.rep_groups (organization_id, name) values ('00000000-0000-0000-0000-000000000001', 'Learned Email Test Group') returning id as g \gset
insert into public.vendors (organization_id, name) values ('00000000-0000-0000-0000-000000000001', 'Learned Email Test Vendor') returning id as v \gset
insert into public.vendors (organization_id, name, rep_group_id) values ('00000000-0000-0000-0000-000000000001', 'Learned Email Test Grouped', :'g') returning id as v2 \gset
insert into public.email_senders (organization_id, sender_key, is_domain, kind, vendor_id) values ('00000000-0000-0000-0000-000000000001', 'learnedmail.example', true, 'vendor', :'v') returning id as s \gset
insert into public.email_threads (organization_id, gmail_thread_id) values ('00000000-0000-0000-0000-000000000001', 'learned-email-thread') returning id as t \gset
insert into public.emails (organization_id, thread_id, gmail_id, direction, from_email, from_name, to_emails, subject, body_text, received_at, sender_id, vendor_id)
values ('00000000-0000-0000-0000-000000000001', :'t', 'learned-email-1', 'in', 'pat@learnedmail.example', 'Pat Lee', '{}', 'Your order', E'Thanks\nPat Lee\nSales', now() - interval '1 day', :'s', :'v')
returning id as e \gset

\echo '>>> the queue hands each email with its id'
select (emails -> 0 ->> 'id') = :'e' as queue_has_email_id from public.contact_learn_queue('00000000-0000-0000-0000-000000000001', 50) where email = 'pat@learnedmail.example';

insert into public.vendor_emails (organization_id, vendor_id, email, contact_name, source, notes, learned_email_id)
values ('00000000-0000-0000-0000-000000000001', :'v', 'pat@learnedmail.example', 'Pat Lee', 'email_enrichment', 'Learned from email', :'e') returning id as ve \gset
insert into public.vendor_emails (organization_id, vendor_id, email, contact_name, source, notes, learned_email_id)
values ('00000000-0000-0000-0000-000000000001', :'v2', 'sam@learnedmail.example', 'Sam Rep', 'email_enrichment', 'Learned from email', :'e') returning id as ve2 \gset
select learned_email_id = :'e' as stored from public.vendor_emails where id = :'ve';

\echo '>>> a learned card moved onto the rep group keeps its email'
select public.vendor_contact_to_rep_group(:'ve2') as gc \gset
select learned_email_id = :'e' as moved_with_email from public.rep_group_contacts where id = :'gc';

\echo '>>> deleting the email leaves the contacts, with no email'
delete from public.emails where id = :'e';
select learned_email_id is null as vendor_contact_cleared from public.vendor_emails where id = :'ve';
select learned_email_id is null as group_contact_cleared from public.rep_group_contacts where id = :'gc';

delete from public.rep_group_contacts where id = :'gc';
delete from public.vendor_emails where id = :'ve';
delete from public.email_threads where id = :'t';
delete from public.email_senders where id = :'s';
delete from public.vendors where id in (:'v', :'v2');
delete from public.rep_groups where id = :'g';
