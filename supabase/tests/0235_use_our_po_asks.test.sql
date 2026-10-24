\set ON_ERROR_STOP on
\pset footer off
\echo '>>> They did not use our PO: the ask, sent, their answer logged; updated confirmation replaces the old; too late uses theirs'
reset role;
select set_config('request.jwt.claims', '', false) is not null as service;
insert into public.vendors (organization_id, name, po_code, email) values ('00000000-0000-0000-0000-000000000001', 'PO235 PLANET', 'PLAN', 'mary@po235.example.com') returning id as v \gset
insert into public.orders (organization_id, vendor_id, status, order_date) values ('00000000-0000-0000-0000-000000000001', :'v', 'open', current_date) returning id as o \gset
select po_number as ours from public.orders where id = :'o' \gset
insert into public.email_threads (organization_id, gmail_thread_id, subject, last_message_at) values ('00000000-0000-0000-0000-000000000001', 'po235', 'Sales order 104125', now()) returning id as t \gset
insert into public.emails (organization_id, thread_id, gmail_id, direction, from_email, subject, body_text, received_at)
values ('00000000-0000-0000-0000-000000000001', :'t', 'po235-1', 'in', 'mary@po235.example.com', 'Sales order 104125', 'Attached', now() - interval '2 hours') returning id as e1 \gset
insert into public.vendor_links (organization_id, vendor_id, kind, label, url, order_id) values ('00000000-0000-0000-0000-000000000001', :'v', 'confirmation', '104125', 'https://example.com/104125', :'o') returning id as d1 \gset
insert into public.order_checks (organization_id, vendor_id, document_id, kind, status, order_id, email_id, po_number, doc_number, reading, doc_date) values
  ('00000000-0000-0000-0000-000000000001', :'v', :'d1', 'confirmation', 'to_review', :'o', :'e1', '26569', '104125', '{"po_number":"26569"}', current_date) returning id as c1 \gset

-- their own PO: the friendly email, and the ask recorded with it
select public.order_check_po_followup(:'c1') = 'drafted' as drafted;
select a.kind = 'use' and a.their_po = '26569' and a.our_po = :'ours' and a.status = 'drafted' and d.body like '%Could you please change the order to our PO and send us an updated confirmation?%'
  as ask_with_draft from public.po_asks a join public.email_drafts d on d.id = a.draft_id where a.check_id = :'c1';
select draft_id as dr from public.po_asks where check_id = :'c1' \gset
-- sending it stamps the ask and logs it on the order
insert into public.emails (organization_id, thread_id, gmail_id, direction, from_email, subject, body_text, received_at)
values ('00000000-0000-0000-0000-000000000001', :'t', 'po235-2', 'out', 'orders@example.com', 'Our PO', 'Please change', now() - interval '1 hour') returning id as e2 \gset
select count(*) = 1 as sent from (select public.mail_command_sent(:'dr', :'e2', '11111111-1111-1111-1111-111111111111')) x;
select status = 'asked' and ask_email_id = :'e2' and thread_id = :'t' and asked_at is not null as asked from public.po_asks where check_id = :'c1';
select count(*) = 1 as logged_asked from public.activity_log where entity_id = :'o' and action = 'po_asked';
-- nothing new yet: no replies to read
select count(*) = 0 as no_replies_yet from public.po_ask_replies('00000000-0000-0000-0000-000000000001') where ask_id = (select id from public.po_asks where check_id = :'c1');
-- their reply: yes, they'll change it
insert into public.emails (organization_id, thread_id, gmail_id, direction, from_email, subject, body_text, received_at)
values ('00000000-0000-0000-0000-000000000001', :'t', 'po235-3', 'in', 'mary@po235.example.com', 'Re: Our PO', 'Sure, I will update it', now() - interval '30 minutes') returning id as e3 \gset
select ask_id as a1 from public.po_ask_replies('00000000-0000-0000-0000-000000000001') where :'e3' = any (email_ids) \gset
select public.po_ask_answer(:'a1', :'e3', 'yes', 'Sure, I will update it') = 'yes' as answered_yes;
select status = 'yes' and answer_email_id = :'e3' as yes_logged from public.po_asks where id = :'a1';
select count(*) = 0 as read_once from public.po_ask_replies('00000000-0000-0000-0000-000000000001') where ask_id = :'a1';
-- the updated confirmation with our PO: old one to Old, new one Final (replaced PO 26569)
insert into public.vendor_links (organization_id, vendor_id, kind, label, url, order_id) values ('00000000-0000-0000-0000-000000000001', :'v', 'confirmation', '104125 rev', 'https://example.com/104125b', :'o') returning id as d2 \gset
insert into public.order_checks (organization_id, vendor_id, document_id, kind, status, order_id, po_number, doc_number, reading, doc_date) values
  ('00000000-0000-0000-0000-000000000001', :'v', :'d2', 'confirmation', 'to_review', :'o', :'ours', '104125', jsonb_build_object('po_number', :'ours'), current_date) returning id as c2 \gset
select public.order_check_po_followup(:'c2') is null as ours_now;
select (select superseded_at is not null from public.vendor_links where id = :'d1') and (select replaced_po = '26569' and superseded_at is null from public.vendor_links where id = :'d2')
   and (select status = 'replaced' and new_check_id = :'c2' from public.po_asks where id = :'a1') as replaced;
select count(*) = 1 as logged_replaced from public.activity_log where entity_id = :'o' and action = 'po_replaced';

-- another order: too late → their PO on the order (noted), a thank-you draft, and a Review card when the PO is in LS
insert into public.orders (organization_id, vendor_id, status, order_date, ls_order_id) values ('00000000-0000-0000-0000-000000000001', :'v', 'open', current_date - 1, '77') returning id as o2 \gset
select po_number as ours2 from public.orders where id = :'o2' \gset
insert into public.vendor_links (organization_id, vendor_id, kind, label, url, order_id) values ('00000000-0000-0000-0000-000000000001', :'v', 'confirmation', '104300', 'https://example.com/104300', :'o2') returning id as d3 \gset
insert into public.order_checks (organization_id, vendor_id, document_id, kind, status, order_id, email_id, po_number, reading, doc_date) values
  ('00000000-0000-0000-0000-000000000001', :'v', :'d3', 'confirmation', 'to_review', :'o2', :'e1', '26601', '{"po_number":"26601"}', current_date) returning id as c3 \gset
select public.order_check_po_followup(:'c3') = 'drafted' as drafted2;
select id as a2, draft_id as dr2 from public.po_asks where check_id = :'c3' \gset
select count(*) = 1 as sent2 from (select public.mail_command_sent(:'dr2', :'e2', null)) x;
select public.po_ask_answer(:'a2', :'e3', 'too_late', 'It already went to production') = 'too_late' as answered_late;
select po_number = '26601' and not po_auto and notes like '%PO changed from our ' || :'ours2' || ' to their 26601%too late%' as order_uses_theirs from public.orders where id = :'o2';
select d.body like '%thank you for trying%We''ll use 26601 for this order.%' as thanks_draft from public.po_asks a join public.email_drafts d on d.id = a.thanks_draft_id where a.id = :'a2';
select r.kind = 'ls_po_reference' and r.status = 'pending' and r.details->>'to' = '26601' and r.assigned_to = public.org_admin(r.organization_id) as ls_card
  from public.po_asks a join public.review_items r on r.id = a.review_item_id where a.id = :'a2';
select public.order_check_po_followup(:'c3') is null as their_po_now_stands;
-- a buyer can't answer the Reference # card; Dana can
select review_item_id as ri from public.po_asks where id = :'a2' \gset
select set_config('request.jwt.claims', '{"sub":"33333333-3333-3333-3333-333333333333","role":"authenticated"}', false) is not null as buyer_in;
set role authenticated;
do $$ begin
  perform public.ls_po_reference_answer((select id from public.review_items where kind = 'ls_po_reference' and title like '%PO235 PLANET%'), false);
  raise exception 'a buyer answered';
exception when insufficient_privilege then null; end $$;
reset role;
select set_config('request.jwt.claims', '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}', false) is not null as dana_in;
set role authenticated;
select count(*) = 1 as dana_answers from (select public.ls_po_reference_answer(:'ri', false)) x;
reset role;
select status = 'rejected' and resolution_note like 'Kept %' as kept_ours_in_ls from public.review_items where id = :'ri';

update public.order_checks set po_draft_id = null where vendor_id = :'v';
delete from public.po_asks where vendor_id = :'v';
delete from public.review_items where id = :'ri';
delete from public.email_drafts where vendor_id = :'v';
delete from public.activity_log where entity_id in (:'o', :'o2');
delete from public.order_checks where vendor_id = :'v';
delete from public.vendor_links where vendor_id = :'v';
delete from public.emails where thread_id = :'t';
delete from public.email_threads where id = :'t';
delete from public.orders where vendor_id = :'v';
delete from public.vendors where id = :'v';
