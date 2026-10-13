\set ON_ERROR_STOP on
\pset footer off
\echo '>>> Routing letter on the vendor form: Yes marks it received, No prepares it'
reset role;
select set_config('request.jwt.claims', '', false) is not null as service;
insert into public.vendors (organization_id, name) values ('00000000-0000-0000-0000-000000000001', 'Routing Form Vendor') returning id as v \gset
insert into public.routing_letters (organization_id, version, storage_path, file_name, email_body, created_by)
values ('00000000-0000-0000-0000-000000000001', 91, 'x/routing.pdf', 'routing.pdf', E'Hi {first_name},\n{open_orders}\n{receipt_link}', '11111111-1111-1111-1111-111111111111') returning id as l \gset
insert into public.vendor_confirmations (organization_id, vendor_id, email, contact_name, sent_at, sent_by)
values ('00000000-0000-0000-0000-000000000001', :'v', 'yes@routing.example', 'Yolanda Yes', now(), '22222222-2222-2222-2222-222222222222') returning token as tyes \gset
insert into public.vendor_confirmations (organization_id, vendor_id, email, contact_name, sent_at, sent_by)
values ('00000000-0000-0000-0000-000000000001', :'v', 'no@routing.example', 'Ned No', now(), '22222222-2222-2222-2222-222222222222') returning token as tno \gset
-- Yolanda already got the letter
insert into public.routing_letter_sends (organization_id, letter_id, vendor_id, contact_name, email, sent_at) values ('00000000-0000-0000-0000-000000000001', :'l', :'v', 'Yolanda Yes', 'yes@routing.example', now() - interval '2 days');
select (public.vendor_confirm_get(:'tyes')->'routing'->>'version')::int as form_shows_version;
select public.vendor_confirm_routing(:'tyes', 'yes') as yes_result;
select received_at is not null as yes_received from public.routing_letter_sends where letter_id = :'l' and email = 'yes@routing.example';
select public.vendor_confirm_routing(:'tno', 'no') as no_result;
select s.sent_at is null as not_sent_yet, d.to_emails, d.owner_id = '22222222-2222-2222-2222-222222222222' as owner_is_sender, d.body like 'Hi Ned,%' as greeting
  from public.routing_letter_sends s join public.email_drafts d on d.id = s.draft_id where s.letter_id = :'l' and s.email = 'no@routing.example';
select public.vendor_confirm_routing(:'tno', 'no') as again_waiting;
select routing_answer from public.vendor_confirmations where token in (:'tyes', :'tno') order by email desc;
delete from public.email_drafts where vendor_id = :'v';
delete from public.routing_letter_sends where letter_id = :'l';
delete from public.vendor_confirmations where vendor_id = :'v';
delete from public.routing_letters where id = :'l';
delete from public.vendors where id = :'v';
