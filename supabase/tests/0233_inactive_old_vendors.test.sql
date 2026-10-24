\set ON_ERROR_STOP on
\pset footer off
\echo '>>> Inactive vendors: why and when, the card when we may be ordering again, reactivate'
reset role;
select set_config('request.jwt.claims', '', false) is not null as service;
select mailbox as box from public.mail_accounts where organization_id = '00000000-0000-0000-0000-000000000001' \gset
insert into public.vendors (organization_id, name) values ('00000000-0000-0000-0000-000000000001', 'OLD233 ROPE WORKS') returning id as v \gset
update public.vendors set is_active = false, inactive_reason = 'Nothing new in LS since the move to LS' where id = :'v';
select inactive_at is not null and inactive_reason is not null as stamped from public.vendors where id = :'v';
update public.vendors set inactive_at = now() - interval '1 day' where id = :'v';
-- mail naming it: queued once; Claude says ordering → one card
insert into public.email_threads (organization_id, gmail_thread_id, subject, last_message_at) values ('00000000-0000-0000-0000-000000000001', 'old233', 'Catalog', now()) returning id as t \gset
insert into public.emails (organization_id, thread_id, gmail_id, direction, from_email, to_emails, subject, body_text, received_at) values
 ('00000000-0000-0000-0000-000000000001', :'t', 'old233-1', 'out', :'box', array['sales@old233.test'], 'Catalog request', 'Could Old233 Rope Works send us your 2027 catalog and price list?', now()) returning id as e1 \gset
select public.inactive_vendor_mail_find('00000000-0000-0000-0000-000000000001') >= 1 and public.inactive_vendor_mail_find('00000000-0000-0000-0000-000000000001') = 0 as queued_once;
select vendor_id = :'v' as right_vendor from public.inactive_vendor_mail where email_id = :'e1';
select public.inactive_vendor_mail_read(:'e1', true, 'We asked them for their 2027 catalog and price list') is not null as card_made;
select count(*) = 1 and bool_and(details->>'email_id' = :'e1' and details->>'thread_id' = :'t') as one_card_with_the_email
  from public.review_items where kind = 'inactive_vendor' and entity_id = :'v' and status = 'pending';
-- an order for it adds to the same card
insert into public.orders (organization_id, vendor_id, po_number) values ('00000000-0000-0000-0000-000000000001', :'v', 'OLD233-1') returning id as o \gset
select count(*) = 1 and bool_and((details->>'more')::int = 1) as still_one_card from public.review_items where kind = 'inactive_vendor' and entity_id = :'v' and status = 'pending';
select id as card from public.review_items where kind = 'inactive_vendor' and entity_id = :'v' \gset
-- a viewer cannot answer; Dana makes it active again
select set_config('request.jwt.claims', '{"sub":"44444444-4444-4444-4444-444444444444","role":"authenticated"}', false) is not null as viewer;
set role authenticated;
do $$ begin perform public.inactive_vendor_answer((select id from public.review_items where kind = 'inactive_vendor' and title like 'OLD233%'), true); raise exception 'viewer answered'; exception when insufficient_privilege then null; end $$;
reset role;
select set_config('request.jwt.claims', '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}', false) is not null as dana;
set role authenticated;
select count(*) = 1 as answered from (select public.inactive_vendor_answer(:'card', true)) x;
reset role;
select set_config('request.jwt.claims', '', false) is not null as service2;
select is_active and inactive_reason is null and inactive_at is null as active_again from public.vendors where id = :'v';
select status = 'accepted' as card_closed from public.review_items where id = :'card';
delete from public.review_items where entity_id = :'v';
delete from public.activity_log where entity_id = :'v';
delete from public.orders where id = :'o';
delete from public.inactive_vendor_mail where vendor_id = :'v';
delete from public.emails where thread_id = :'t';
delete from public.email_threads where id = :'t';
delete from public.vendors where id = :'v';
