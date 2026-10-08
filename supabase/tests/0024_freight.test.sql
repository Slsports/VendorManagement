\set ON_ERROR_STOP on
\pset footer off
\echo '>>> a carrier domain makes the sender a carrier; its thread goes to the carrier owner (TJ here)'
reset role;
select set_config('request.jwt.claims', '', false) is not null as as_service;
insert into public.carriers (organization_id, name, mode, email_domains, owner_id) values ('00000000-0000-0000-0000-000000000001', 'Test Express', 'parcel', '{testex.com}', '33333333-3333-3333-3333-333333333333') returning id as car \gset
insert into public.email_senders (organization_id, sender_key, is_domain) values ('00000000-0000-0000-0000-000000000001', 'testex.com', true) returning kind, carrier_id = :'car' as is_carrier, id as fs \gset
insert into public.email_threads (organization_id, gmail_thread_id) values ('00000000-0000-0000-0000-000000000001', 'frt1') returning id as ft \gset
insert into public.emails (organization_id, gmail_id, thread_id, direction, from_email, subject, received_at, sender_id)
values ('00000000-0000-0000-0000-000000000001', 'frm1', :'ft', 'in', 'do-not-reply@testex.com', 'Invoice 261005W105025', now(), :'fs');
select carrier_id = :'car' as freight_thread, owner_id = '33333333-3333-3333-3333-333333333333'::uuid as to_owner from public.email_threads where id = :'ft';
\echo '>>> a bill with two shippers: the fee goes to the bigger order; confirming puts freight on each order'
insert into public.vendors (organization_id, name) values ('00000000-0000-0000-0000-000000000001', 'Freight Test Small') returning id as fv1 \gset
insert into public.vendors (organization_id, name) values ('00000000-0000-0000-0000-000000000001', 'Freight Test Big') returning id as fv2 \gset
insert into public.orders (organization_id, vendor_id, est_cost) values ('00000000-0000-0000-0000-000000000001', :'fv1', 100) returning id as fo1 \gset
insert into public.orders (organization_id, vendor_id, est_cost) values ('00000000-0000-0000-0000-000000000001', :'fv2', 1000) returning id as fo2 \gset
insert into public.freight_bills (organization_id, carrier_id, total, fee_amount, status) values ('00000000-0000-0000-0000-000000000001', :'car', 85.95, 7.95, 'to_match') returning id as fb \gset
insert into public.freight_bill_lines (organization_id, bill_id, shipper_name, amount, sort_order) values ('00000000-0000-0000-0000-000000000001', :'fb', 'Small Co', 30, 0) returning id as fl1 \gset
insert into public.freight_bill_lines (organization_id, bill_id, shipper_name, amount, sort_order) values ('00000000-0000-0000-0000-000000000001', :'fb', 'Big Co', 48, 1) returning id as fl2 \gset
set role authenticated;
select set_config('request.jwt.claims', '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}', false);
select public.freight_set_line(:'fl1', :'fv1', :'fo1', true);
select public.freight_set_line(:'fl2', :'fv2', :'fo2', true);
select shipper_name, amount, fee_amount, confirmed from public.freight_bill_lines where bill_id = :'fb' order by sort_order;
select (select freight_cost from public.orders where id = :'fo1') as small_freight, (select freight_cost from public.orders where id = :'fo2') as big_freight, (select status from public.freight_bills where id = :'fb') as bill;
\echo '>>> an order of another vendor is refused; the viewer cannot match (expect 2 errors)'
\set ON_ERROR_STOP off
select public.freight_set_line(:'fl1', :'fv1', :'fo2', true);
select set_config('request.jwt.claims', '{"sub":"44444444-4444-4444-4444-444444444444","role":"authenticated"}', false);
select public.freight_set_line(:'fl1', :'fv1', :'fo1', false);
\set ON_ERROR_STOP on
reset role;
\echo '>>> order lines: organization filled from the order, extended computed; pricing defaults on the organization'
set role authenticated;
select set_config('request.jwt.claims', '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}', false);
insert into public.order_lines (order_id, vendor_item_id, description, quantity, unit_cost) values (:'fo2', 'TOY-1', 'Toy', 12, 5) returning organization_id = '00000000-0000-0000-0000-000000000001'::uuid as org_filled, extended;
reset role;
select settings->'pricing' as pricing from public.organizations where id = '00000000-0000-0000-0000-000000000001';
