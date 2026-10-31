\set ON_ERROR_STOP on
\pset footer off
\echo '>>> 0271: no new quote in a conversation with an approved price; our own note to one of us is not a quote'
reset role;
select set_config('request.jwt.claims', '', false) is not null as service;
select mailbox as box from public.mail_accounts where organization_id = '00000000-0000-0000-0000-000000000001' \gset
insert into public.vendors (organization_id, name) values ('00000000-0000-0000-0000-000000000001', 'FQ271') returning id as v \gset
insert into public.email_threads (organization_id, gmail_thread_id, subject, last_message_at) values ('00000000-0000-0000-0000-000000000001', 'fq271', 'READY TO SHIP', now()) returning id as t \gset
insert into public.emails (organization_id, thread_id, gmail_id, direction, from_email, to_emails, subject, body_text, received_at, vendor_id) values
  ('00000000-0000-0000-0000-000000000001', :'t', 'fq271-1', 'in', 'routing@fq271.example', array[:'box'], 'READY TO SHIP', 'FedEx Ground $375.87 freight', now() - interval '2 days', :'v'),
  ('00000000-0000-0000-0000-000000000001', :'t', 'fq271-2', 'in', 'routing@fq271.example', array[:'box'], 'READY TO SHIP', 'please proceed with freight at $375.87', now(), :'v'),
  ('00000000-0000-0000-0000-000000000001', :'t', 'fq271-3', 'in', 'staff271@ourshop.example', array['trevor271@ourshop.example'], 'Fwd: READY TO SHIP', 'Can you get a freight quote from ups', now(), :'v');
insert into public.email_senders (organization_id, sender_key, kind) values ('00000000-0000-0000-0000-000000000001', 'ourshop.example', 'internal') on conflict do nothing;
update public.mail_accounts set internal_domains = array_append(coalesce(internal_domains, '{}'), 'ourshop.example') where organization_id = '00000000-0000-0000-0000-000000000001' and not ('ourshop.example' = any (coalesce(internal_domains, '{}')));
select public.freight_quote_apply((select id from public.emails where gmail_id = 'fq271-1'), true, '{"carrier":"FedEx Ground","cost":"375.87"}'::jsonb, :'v', null, null) as q \gset
update public.freight_quotes set status = 'approved', approved_choice = 'vendor', approved_cost = 375.87 where id = :'q';
select public.freight_quote_apply((select id from public.emails where gmail_id = 'fq271-2'), true, '{"cost":"375.87"}'::jsonb, :'v', null, null) is null as no_second_quote;
select not exists (select 1 from public.freight_quote_queue('00000000-0000-0000-0000-000000000001', 500) x where x.email_id = (select id from public.emails where gmail_id = 'fq271-3')) as own_note_not_read;
delete from public.tasks where vendor_id = :'v';
delete from public.freight_quotes where vendor_id = :'v';
delete from public.emails where thread_id = :'t';
delete from public.email_threads where id = :'t';
delete from public.vendors where id = :'v';
