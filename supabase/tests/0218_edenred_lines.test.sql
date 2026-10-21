\set ON_ERROR_STOP on
\pset footer off
\echo '>>> Edenred lines: invoice lines, order items, freight, PO, vendor active, credits; shared freight bills'
reset role;
select set_config('request.jwt.claims', '', false) is not null as service;
insert into public.vendors (organization_id, name, po_code) values ('00000000-0000-0000-0000-000000000001', 'EDEN218 CO', 'EDEN') returning id as v \gset
insert into public.orders (organization_id, vendor_id, status, po_number, order_date, est_cost) values ('00000000-0000-0000-0000-000000000001', :'v', 'entered', 'EDEN091526', '2026-09-15', 100) returning id as o1 \gset
insert into public.orders (organization_id, vendor_id, status, po_number, order_date, freight_cost) values ('00000000-0000-0000-0000-000000000001', :'v', 'entered', 'EDEN100126', '2026-10-01', 9.99) returning id as o2 \gset
insert into public.orders (organization_id, vendor_id, status, po_number, order_date) values ('00000000-0000-0000-0000-000000000001', :'v', 'entered', 'EDEN101026', '2026-10-10') returning id as o3 \gset
insert into public.wwd_invoices (organization_id, seq, kind, vendor_id, po_number, vendor_invoice_number, amount, order_id, wwd_date) values
  ('00000000-0000-0000-0000-000000000001', '9100001', 'invoice', :'v', 'EDEN091526', 'A-1', 110, :'o1', '2026-09-20'),
  ('00000000-0000-0000-0000-000000000001', '9100002', 'invoice', :'v', 'ZZ-OWN-77', 'A-2', 60, :'o2', '2026-10-05'),
  ('00000000-0000-0000-0000-000000000001', '9100003', 'invoice', :'v', 'EDEN101026', 'A-3', 40, null, '2026-10-12'),
  ('00000000-0000-0000-0000-000000000001', '9100004', 'credit', :'v', 'EDEN091526', 'CM-1', -10, null, '2026-10-01'),
  ('00000000-0000-0000-0000-000000000001', '9100005', 'credit', :'v', null, 'CM-2', -5, null, '2026-10-02');

select public.wwd_edenred_lines(jsonb_build_object('organization_id', '00000000-0000-0000-0000-000000000001', 'as_of', '2026-10-21', 'invoices', jsonb_build_array(
  jsonb_build_object('seq', '09100001', 'nd_freight', 'N', 'vendor_active', 'A', 'tracking', '1Z999', 'freight', '10', 'lines', jsonb_build_array(
    jsonb_build_object('vid', 'PPS-4', 'upc', '015789059514', 'desc', 'Scissors', 'qty', '10', 'price', '10', 'unit_discount', '1', 'amount', '90'),
    jsonb_build_object('desc', 'FREIGHT', 'qty', '1', 'price', '10', 'amount', '10'))),
  jsonb_build_object('seq', '9100002', 'nd_freight', 'Y', 'vendor_active', 'A', 'freight', '12.50', 'lines', jsonb_build_array(jsonb_build_object('vid', 'X1', 'desc', 'Thing', 'qty', '2', 'price', '23.75', 'amount', '47.5'))),
  jsonb_build_object('seq', '9100003', 'vendor_active', 'A', 'lines', jsonb_build_array(jsonb_build_object('vid', 'Y1', 'desc', 'Other', 'qty', '4', 'price', '10', 'amount', '40'))),
  jsonb_build_object('seq', '9100004', 'credit', true, 'vendor_active', 'A', 'lines', jsonb_build_array(jsonb_build_object('desc', 'damaged', 'amount', '-10'))),
  jsonb_build_object('seq', '9100005', 'credit', true, 'vendor_active', 'A', 'lines', jsonb_build_array(jsonb_build_object('desc', 'short', 'amount', '-5'))),
  jsonb_build_object('seq', '9999999', 'lines', '[]'::jsonb)))) as result \gset
select (:'result'::jsonb)->>'invoices' = '5' and (:'result'::jsonb)->>'not_in_vms' = '1' as counted;
select count(*) = 2 and bool_or(is_freight) as lines_kept from public.wwd_invoice_lines l join public.wwd_invoices w on w.id = l.invoice_id where w.seq = '9100001';
select nd_freight = false and tracking_no = '1Z999' and edenred_freight = 10 and po_result = 'ours' as invoice_fields from public.wwd_invoices where seq = '9100001';
select po_result = 'theirs' and nd_freight as their_po from public.wwd_invoices where seq = '9100002';
select order_id = :'o3' and po_result = 'ours' as tied_by_po from public.wwd_invoices where seq = '9100003';
select count(*) = 1 and min(vendor_item_id) = 'PPS-4' and min(upc) = '015789059514' and min(unit_cost) = 9 and min(extended) = 90 as order_items
  from public.order_lines where order_id = :'o1';
select freight_cost = 10 as freight_filled from public.orders where id = :'o1';
select exists (select 1 from public.review_items where kind = 'wwd_freight_differs' and entity_id = :'o2' and (details->>'edenred')::numeric = 12.5) as freight_card;
select exists (select 1 from public.review_items where kind = 'wwd_po_mismatch' and details->>'seq' = '9100002') as po_card;
select wwd_active and wwd_active_as_of = '2026-10-21' as vendor_active from public.vendors where id = :'v';
select (select credit_for_id from public.wwd_invoices where seq = '9100004') = (select id from public.wwd_invoices where seq = '9100001') as credit_by_po;
select exists (select 1 from public.review_items where kind = 'wwd_credit_for' and details->>'seq' = '9100005') as credit_card;
-- again: nothing doubled
select public.wwd_edenred_lines(jsonb_build_object('organization_id', '00000000-0000-0000-0000-000000000001', 'invoices', jsonb_build_array(
  jsonb_build_object('seq', '9100002', 'freight', '12.50', 'lines', jsonb_build_array(jsonb_build_object('vid', 'X1', 'desc', 'Thing', 'qty', '2', 'price', '23.75', 'amount', '47.5')))))) is not null as again;
select (select count(*) from public.review_items where kind = 'wwd_freight_differs' and entity_id = :'o2') = 1 and (select count(*) from public.order_lines where order_id = :'o2') = 1 as once_only;

-- cards answered
set role authenticated;
select set_config('request.jwt.claims', '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}', false) is not null as admin_in;
select (public.vendor_po_use(:'v')).ours = 2 as po_use;
select public.wwd_review_answer((select id from public.review_items where kind = 'wwd_freight_differs' and entity_id = :'o2'), 'use_edenred');
select public.wwd_review_answer((select id from public.review_items where kind = 'wwd_credit_for' and details->>'seq' = '9100005'), 'pick', (select id from public.wwd_invoices where seq = '9100002'));
reset role;
select set_config('request.jwt.claims', '', false) is not null as service;
select freight_cost = 12.5 as freight_used from public.orders where id = :'o2';
select credit_for_id = (select id from public.wwd_invoices where seq = '9100002') as credit_picked from public.wwd_invoices where seq = '9100005';

-- shared freight: a carrier's WWD bill becomes a shared bill; orders added share it by merchandise cost
insert into public.carriers (organization_id, name) values ('00000000-0000-0000-0000-000000000001', 'XPO218') returning id as c \gset
insert into public.wwd_invoices (organization_id, seq, kind, carrier_id, vendor_invoice_number, vendor_invoice_date, amount, wwd_date) values
  ('00000000-0000-0000-0000-000000000001', '9100010', 'invoice', :'c', 'XPO-1', '2026-09-10', 300, '2026-09-12'),
  ('00000000-0000-0000-0000-000000000001', '9100011', 'invoice', :'c', 'XPO-OLD', '2026-03-05', 100, '2026-03-10');
select public.freight_shared_from_wwd('00000000-0000-0000-0000-000000000001') = 1 as one_bill_made;
select id as b from public.freight_bills where invoice_number = 'XPO-1' \gset
select shared and total = 300 as shared_bill from public.freight_bills where id = :'b';
select exists (select 1 from public.tasks where auto_key = 'freight_share:' || :'b') as task_made;
select not exists (select 1 from public.freight_bills where invoice_number = 'XPO-OLD') as old_left_alone;
update public.orders set final_cost = 200 where id = :'o2';
update public.orders set final_cost = 100 where id = :'o3';
set role authenticated;
select set_config('request.jwt.claims', '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}', false) is not null as admin_in;
select count(*) >= 2 as search_by_vendor from public.freight_share_search('00000000-0000-0000-0000-000000000001', 'EDEN218');
select count(*) = 1 as search_by_seq from public.freight_share_search('00000000-0000-0000-0000-000000000001', '09100003');
select public.freight_share_set(:'b', jsonb_build_array(jsonb_build_object('order_id', :'o2'), jsonb_build_object('order_id', :'o3')));
reset role;
select set_config('request.jwt.claims', '', false) is not null as service;
select (select freight_cost from public.orders where id = :'o2') = 200 and (select freight_cost from public.orders where id = :'o3') = 100 as by_merch_cost;
select done_at is not null as task_done from public.tasks where auto_key = 'freight_share:' || :'b';
set role authenticated;
select set_config('request.jwt.claims', '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}', false) is not null as admin_in;
select public.freight_share_set(:'b', jsonb_build_array(jsonb_build_object('order_id', :'o2', 'amount', 50), jsonb_build_object('order_id', :'o3')));
select (select amount from public.freight_bill_lines where bill_id = :'b' and order_id = :'o2') = 50 and (select amount from public.freight_bill_lines where bill_id = :'b' and order_id = :'o3') = 250 as typed_kept;
do $$ begin
  perform public.freight_share_set((select id from public.freight_bills where invoice_number = 'XPO-1'), jsonb_build_array(jsonb_build_object('order_id', (select id from public.orders where po_number = 'EDEN100126'), 'amount', 10)));
  raise exception 'should not save amounts that do not add up';
exception when sqlstate '22023' then null; end $$;
select public.freight_share_set(:'b', jsonb_build_array(jsonb_build_object('order_id', :'o3')));
reset role;
select set_config('request.jwt.claims', '', false) is not null as service;
select (select freight_cost from public.orders where id = :'o3') = 300 and (select freight_cost from public.orders where id = :'o2') is null as taken_off_back_to_none;

delete from public.tasks where auto_key like 'freight_share:%' and carrier_id = :'c';
delete from public.freight_bills where carrier_id = :'c';
delete from public.review_items where kind in ('wwd_freight_differs', 'wwd_po_mismatch', 'wwd_credit_for') and (entity_id in (:'o1', :'o2', :'o3') or details->>'vendor_id' = :'v');
delete from public.order_lines where order_id in (:'o1', :'o2', :'o3');
update public.wwd_invoices set credit_for_id = null, order_id = null where vendor_id = :'v' or carrier_id = :'c';
delete from public.wwd_invoices where vendor_id = :'v' or carrier_id = :'c';
delete from public.orders where vendor_id = :'v';
delete from public.carriers where id = :'c';
delete from public.vendors where id = :'v';
