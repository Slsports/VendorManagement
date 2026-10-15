\set ON_ERROR_STOP on
\pset footer off
\echo '>>> This is our order: a confirmation with no order becomes the order, with its lines'
reset role;
select set_config('request.jwt.claims', '', false) is not null as service;
insert into public.vendors (organization_id, name, order_set_at_show) values ('00000000-0000-0000-0000-000000000001', 'Show Test Co', true) returning id as v \gset
insert into public.vendor_links (organization_id, vendor_id, kind, label, url, file_name, source)
values ('00000000-0000-0000-0000-000000000001', :'v', 'confirmation', 'S1', 'https://x/s1.pdf', 'S1.pdf', 'email') returning id as d \gset
insert into public.order_checks (organization_id, vendor_id, kind, document_id, status, doc_number, doc_date, doc_total, reading)
values ('00000000-0000-0000-0000-000000000001', :'v', 'confirmation', :'d', 'to_review', 'S1', '2026-09-29', 100,
        '{"lines":[{"vendor_item_id":"BG-81","description":"BAG","quantity":18,"unit_cost":5},{"vendor_item_id":"983","description":"MAT","quantity":0,"unit_cost":1},{"vendor_item_id":"NEW1","description":"NEW TEE","quantity":2,"unit_cost":5}]}')
returning id as c \gset
set role authenticated;
select set_config('request.jwt.claims', '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}', false) is not null as admin_in;
select public.order_check_use_as_order(:'c') is not null as made_order;
reset role;
select set_config('request.jwt.claims', '', false) is not null as service;
select c.status, c.outcome, o.status as order_status, o.source, o.order_date, (select count(*) from public.order_lines l where l.order_id = o.id) as lines,
       (select sum(quantity) from public.order_lines l where l.order_id = o.id) as units
  from public.order_checks c join public.orders o on o.id = c.order_id where c.id = :'c';
delete from public.order_lines where order_id = (select order_id from public.order_checks where id = :'c');
delete from public.order_checks where id = :'c';
delete from public.orders where vendor_id = :'v';
delete from public.vendor_links where vendor_id = :'v';
delete from public.vendors where id = :'v';
