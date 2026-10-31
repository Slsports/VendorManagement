\set ON_ERROR_STOP on
\pset footer off
\echo '>>> 0275: the same order twice becomes one card; keeping one folds the other in; two confirmations are two orders'
reset role;
select set_config('request.jwt.claims', '', false) is not null as service;
insert into public.vendors (organization_id, name) values ('00000000-0000-0000-0000-000000000001', 'DUP275') returning id as v \gset
insert into public.orders (organization_id, vendor_id, po_number, status, order_date, show_code, description) values
  ('00000000-0000-0000-0000-000000000001', :'v', 'DUP0204', 'open', '2026-02-04', 'wwd_spring_2026', 'BIBS, PANTS, JACKETS') returning id as a \gset
insert into public.orders (organization_id, vendor_id, po_number, status, order_date, description, est_cost) values
  ('00000000-0000-0000-0000-000000000001', :'v', 'DUP2426', 'entered', '2026-02-04', 'JACKETS AND BIBS', 4411.00) returning id as b \gset
insert into public.tasks (organization_id, title, assigned_to, order_id) values ('00000000-0000-0000-0000-000000000001', 'dup275 task', '11111111-1111-1111-1111-111111111111', :'a');
select public.order_duplicate_scan('00000000-0000-0000-0000-000000000001') >= 1 as found;
select id as card from public.review_items where kind = 'order_duplicate' and details->>'vendor_name' = 'DUP275' \gset
select public.order_duplicate_scan('00000000-0000-0000-0000-000000000001') is not null and
       (select count(*) from public.review_items where kind = 'order_duplicate' and details->>'vendor_name' = 'DUP275') = 1 as one_card;
select set_config('request.jwt.claims', '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}', false) is not null as dana_in;
set role authenticated;
select (public.order_duplicate_answer(:'card', :'b'))::text is not null as answered;
reset role;
select set_config('request.jwt.claims', '', false) is not null as service;
select status = 'cancelled' as copy_cancelled from public.orders where (id = :'a' and :'card' is not null);
select show_code = 'wwd_spring_2026' as show_carried, est_cost = 4411.00 as amount_kept from public.orders where id = :'b';
select order_id = :'b' as task_moved from public.tasks where title = 'dup275 task';
-- two confirmation numbers: two real orders, no card
insert into public.orders (organization_id, vendor_id, po_number, status, order_date, description) values
  ('00000000-0000-0000-0000-000000000001', :'v', 'NOW', 'open', '2026-08-01', 'TENTS CANOPY CHAIRS') returning id as c \gset
insert into public.orders (organization_id, vendor_id, po_number, status, order_date, description) values
  ('00000000-0000-0000-0000-000000000001', :'v', 'LATER', 'open', '2026-08-02', 'TENTS CANOPY TABLES') returning id as d \gset
insert into public.vendor_links (organization_id, vendor_id, kind, label, storage_path, file_name, received_at, doc_number, order_id) values
  ('00000000-0000-0000-0000-000000000001', :'v', 'confirmation', 'S1', 'x/s1.pdf', 's1.pdf', current_date, 'S1001', :'c'),
  ('00000000-0000-0000-0000-000000000001', :'v', 'confirmation', 'S2', 'x/s2.pdf', 's2.pdf', current_date, 'S1002', :'d');
select public.order_duplicate_scan('00000000-0000-0000-0000-000000000001') is not null and
       not exists (select 1 from public.review_items where kind = 'order_duplicate' and details->>'pair' in (:'c' || ':' || :'d', :'d' || ':' || :'c')) as ship_now_and_later_not_flagged;
delete from public.order_checks where vendor_id = :'v';
delete from public.vendor_links where vendor_id = :'v';
delete from public.review_items where kind = 'order_duplicate' and details->>'vendor_name' = 'DUP275';
delete from public.tasks where title = 'dup275 task';
delete from public.orders where vendor_id = :'v';
delete from public.vendors where id = :'v';
