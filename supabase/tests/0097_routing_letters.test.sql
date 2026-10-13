\set ON_ERROR_STOP on
\pset footer off
\echo '>>> Routing letter: v1 drafts go to open-order vendors per contact; receipt marks it; v2 goes to everyone who had v1'
reset role;
select set_config('request.jwt.claims', '', false) is not null as service;
insert into public.vendors (organization_id, name, email) values ('00000000-0000-0000-0000-000000000001', 'Routing Test Vendor', 'Orders@Routing.example') returning id as v \gset
insert into public.vendor_emails (vendor_id, email, contact_name, contact_type, roles) values (:'v', 'sam@routing.example', 'Sam Lee', 'rep', '{rep}');
insert into public.orders (organization_id, vendor_id, status, po_number, order_date, est_cost, source) values ('00000000-0000-0000-0000-000000000001', :'v', 'confirmed', 'RT555', date '2026-09-02', 544.56, 'email') returning id as o \gset
set role authenticated;
select set_config('request.jwt.claims', '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}', false) is not null as signed_in;
select public.routing_letter_add('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001/routing/v1.pdf', 'Routing.pdf', date '2026-10-14', null, null, E'Hello {first_name},\n\n{open_orders}\nPlease confirm: {receipt_link}') as l1 \gset
select public.routing_letter_prepare(:'l1', 'open_orders') as drafts;
select public.routing_letter_prepare(:'l1', 'open_orders') as drafts_again;
select d.to_emails, d.body like 'Hello Sam,%' as greeting, d.body like '%PO RT555, placed 9/2/26, $544.56%' as orders_listed, d.body like '%/r/%' as link
  from public.email_drafts d join public.routing_letter_sends s on s.id = d.routing_send_id where s.letter_id = :'l1';
reset role;
select set_config('request.jwt.claims', '', false) is not null as service;
select public.routing_letter_mark_sent(id, null, null) from public.routing_letter_sends where letter_id = :'l1';
select vendor_name, version, received_at is not null as received from public.routing_receipt((select token from public.routing_letter_sends where letter_id = :'l1' limit 1));
set role authenticated;
select set_config('request.jwt.claims', '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}', false) is not null as signed_in;
select public.routing_letter_add('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001/routing/v2.pdf', 'Routing v2.pdf', null, 'New UPS rule', null, 'Hi {first_name}. {receipt_link}') as l2 \gset
select public.routing_letter_prepare(:'l2', 'previous') as v2_drafts;
reset role;
select set_config('request.jwt.claims', '', false) is not null as service;
delete from public.email_drafts where routing_send_id in (select id from public.routing_letter_sends where vendor_id = :'v');
delete from public.routing_letters where id in (:'l1', :'l2');
delete from public.ls_pos where order_id = :'o';
delete from public.orders where id = :'o';
delete from public.vendors where id = :'v';
