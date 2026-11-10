\set ON_ERROR_STOP on
\pset footer off
\echo '>>> Freight terms from email wait on a review card; nothing touches the order until a person answers'
reset role;
select set_config('request.jwt.claims', '', false) is not null as claims_cleared;
select id as admin_id from public.profiles where organization_id = '00000000-0000-0000-0000-000000000001' and role = 'admin' and is_active order by created_at limit 1 \gset
insert into public.rep_groups (organization_id, name) values ('00000000-0000-0000-0000-000000000001', 'Card Test Reps') returning id as rg \gset
insert into public.vendors (organization_id, name, rep_group_id) values ('00000000-0000-0000-0000-000000000001', 'Card Test Brand', :'rg') returning id as v \gset
insert into public.vendors (organization_id, name, rep_group_id) values ('00000000-0000-0000-0000-000000000001', 'Card Test Sister', :'rg') returning id as v2 \gset
insert into public.vendors (organization_id, name) values ('00000000-0000-0000-0000-000000000001', 'Card Test Stranger') returning id as v3 \gset
insert into public.orders (organization_id, vendor_id, status, po_number, order_date, est_cost) values ('00000000-0000-0000-0000-000000000001', :'v2', 'confirmed', 'CTS-1', current_date - 10, 900) returning id as o \gset
insert into public.orders (organization_id, vendor_id, status, po_number, order_date, est_cost) values ('00000000-0000-0000-0000-000000000001', :'v3', 'confirmed', 'CTS-1', current_date - 10, 900) returning id as o3 \gset
insert into public.email_threads (organization_id, gmail_thread_id, subject, vendor_id) values ('00000000-0000-0000-0000-000000000001', 'rc-t1', 'PO CTS-1', :'v') returning id as t1 \gset
insert into public.emails (organization_id, gmail_id, thread_id, direction, from_email, to_emails, subject, body_text, received_at, vendor_id)
  values ('00000000-0000-0000-0000-000000000001', 'rc-e1', :'t1', 'in', 'rep@cardreps.example', array['orders@example.com'], 'Re: PO CTS-1', 'Free freight on CTS-1.', now() - interval '2 days', :'v') returning id as e1 \gset

-- the PO matches the sister vendor's order (same rep group), not the stranger's; a card, the order untouched
select public.freight_promises_save(:'e1', '[{"terms":"free","po":"CTS-1","said_by":"vendor","quote":"Free freight on CTS-1."}]') = 1 as saved;
select id as p, review_item_id as card, order_id = :'o' as matched_rep_group_order, status = 'review' as waits from public.freight_promises where email_id = :'e1' \gset
select :'matched_rep_group_order'::boolean and :'waits'::boolean as card_for_sister_order;
select free_shipping is null and freight_terms is null as order_untouched from public.orders where id = :'o';
select kind = 'freight_terms' and status = 'pending' and title like 'Card Test Brand: Free freight on PO CTS-1%' and details->>'email_id' = :'e1' as card_ready from public.review_items where id = :'card';

-- the same terms again in the conversation: no second card
insert into public.emails (organization_id, gmail_id, thread_id, direction, from_email, to_emails, subject, body_text, received_at, vendor_id)
  values ('00000000-0000-0000-0000-000000000001', 'rc-e2', :'t1', 'in', 'rep@cardreps.example', array['orders@example.com'], 'Re: PO CTS-1', 'As said, free freight.', now() - interval '1 day', :'v') returning id as e2 \gset
select public.freight_promises_save(:'e2', '[{"terms":"free","po":"CTS-1","said_by":"vendor","quote":"As said, free freight."}]') = 0 as no_repeat_card;

-- a person puts it on the order: the terms land with the email as the source, the card is done
set role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', :'admin_id', 'role', 'authenticated')::text, false) is not null as as_admin;
select public.freight_terms_review_answer(:'card', :'o') = 'applied' as answered;
reset role;
select set_config('request.jwt.claims', '', false) is not null as claims_cleared_2;
select free_shipping and freight_terms = 'free' and freight_terms_source = 'person' and freight_terms_source_email_id = :'e1' as order_has_terms from public.orders where id = :'o';
select status = 'accepted' as card_done from public.review_items where id = :'card';

-- a card closes itself when the order is set the same way by another route
insert into public.email_threads (organization_id, gmail_thread_id, subject, vendor_id) values ('00000000-0000-0000-0000-000000000001', 'rc-t2', 'Half freight', :'v2') returning id as t2 \gset
insert into public.emails (organization_id, gmail_id, thread_id, direction, from_email, to_emails, subject, body_text, received_at, vendor_id, order_id)
  values ('00000000-0000-0000-0000-000000000001', 'rc-e3', :'t2', 'in', 'rep@cardreps.example', array['orders@example.com'], 'Half freight', 'We will cover half the freight.', now(), :'v2', :'o') returning id as e3 \gset
select public.freight_promises_save(:'e3', '[{"terms":"half","said_by":"vendor","quote":"We will cover half the freight."}]') = 1 as saved_half;
select review_item_id as card2 from public.freight_promises where email_id = :'e3' \gset
update public.orders set free_shipping = false, freight_terms = 'half', freight_terms_source = 'person' where id = :'o';
select status = 'accepted' and resolution_note like 'VMS closed it:%' as card_closed_itself from public.review_items where id = :'card2';

-- Not for an order
insert into public.emails (organization_id, gmail_id, thread_id, direction, from_email, to_emails, subject, body_text, received_at, vendor_id)
  values ('00000000-0000-0000-0000-000000000001', 'rc-e4', :'t2', 'in', 'rep@cardreps.example', array['orders@example.com'], 'Promo', 'Free freight over $500 this month.', now(), :'v2') returning id as e4 \gset
select public.freight_promises_save(:'e4', '[{"terms":"free_over","free_over":500,"said_by":"vendor","quote":"Free freight over $500 this month."}]') = 1 as saved_promo;
select review_item_id as card3, id as p3 from public.freight_promises where email_id = :'e4' \gset
set role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', :'admin_id', 'role', 'authenticated')::text, false) is not null as as_admin_2;
select public.freight_terms_review_answer(:'card3', null) = 'not_an_order' as set_aside;
reset role;
select set_config('request.jwt.claims', '', false) is not null as claims_cleared_3;
select status = 'not_an_order' as promise_set_aside from public.freight_promises where id = :'p3';

-- clean up
delete from public.review_items where entity_id in (select id from public.freight_promises where vendor_id in (:'v', :'v2'));
delete from public.freight_promises where vendor_id in (:'v', :'v2');
delete from public.email_threads where id in (:'t1', :'t2');
delete from public.orders where id in (:'o', :'o3');
delete from public.vendors where id in (:'v', :'v2', :'v3');
delete from public.rep_groups where id = :'rg';
