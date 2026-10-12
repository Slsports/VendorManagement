\set ON_ERROR_STOP on
\pset footer off
\echo '>>> PO initials and store'
select public.po_parse('TP-SLS 1012') as tp, public.po_parse('gp slh') as gp, public.po_parse('DPGS') as dp, public.po_parse('PO 555') as none;
\echo '>>> an Amazon confirmation with Tyler''s PO: on the list, by person and store; shipped updates it; Supplies skips it'
reset role;
insert into public.po_initials (organization_id, initials, person_name) values ('00000000-0000-0000-0000-000000000001', 'TP', 'Tyler Powell') on conflict do nothing;
insert into public.email_threads (organization_id, gmail_thread_id) values ('00000000-0000-0000-0000-000000000001', 'amt1') returning id as at \gset
insert into public.emails (organization_id, gmail_id, thread_id, direction, from_email, subject, body_text, received_at)
values ('00000000-0000-0000-0000-000000000001', 'amm1', :'at', 'in', 'auto-confirm@amazon.com', 'Your Amazon.com order #111-222', 'PO TP-SLS', now()) returning id as ae \gset
insert into public.emails (organization_id, gmail_id, thread_id, direction, from_email, subject, body_text, received_at)
values ('00000000-0000-0000-0000-000000000001', 'amm2', :'at', 'in', 'shipment-tracking@amazon.com', 'Shipped: your order', 'Order 111-222 shipped', now() + interval '1 hour') returning id as ae2 \gset
select count(*) as queued from public.amazon_queue('00000000-0000-0000-0000-000000000001') where email_id in (:'ae', :'ae2');
select public.amazon_apply(:'ae', 'confirmation', '111-222', 'TP-SLS', 54.20, 'Paper towels', current_date, current_date + 3) is not null as made;
select public.amazon_apply(:'ae2', 'shipped', '111-222', null, null, null, null, current_date + 2) is not null as updated;
select order_number, initials, store_code, person_name, total, status, expected_at = current_date + 2 as expected from public.amazon_orders where order_number = '111-222';
insert into public.supply_requests (organization_id, summary, requested_at) values ('00000000-0000-0000-0000-000000000001', 'Paper towels', now() - interval '2 days');
select count(*) as supplies_sees_it from public.supply_confirmation_queue('00000000-0000-0000-0000-000000000001', 100) where email_id in (:'ae', :'ae2');
set role authenticated;
select set_config('request.jwt.claims', '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}', false);
select store_code, person_name, orders, total from public.amazon_monthly('00000000-0000-0000-0000-000000000001') where person_name = 'Tyler Powell';
reset role;
