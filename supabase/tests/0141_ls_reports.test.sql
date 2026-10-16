\set ON_ERROR_STOP on
\pset footer off
\echo '>>> LS reports: report rows sum completed sales per shop in the period, honour vendor and category filters'
reset role;
select set_config('request.jwt.claims', '', false) is not null as claims_cleared;
insert into public.ls_vendors (organization_id, ls_vendor_id, name) values ('00000000-0000-0000-0000-000000000001', '379', 'TRIPLE T - WWD') on conflict do nothing;
insert into public.ls_items (organization_id, item_id, system_sku, description, category_path, default_vendor_id, vendor_item_id, qoh, archived) values
  ('00000000-0000-0000-0000-000000000001', 'i1', '210000000001', 'NORTHSIDE KIDS HIKER SZ 11', 'FOOTWEAR/HIKING/KIDS', '379', '317489K211', '{"0": 4, "1": 1, "3": 3}', false),
  ('00000000-0000-0000-0000-000000000001', 'i2', '210000000002', 'OLD BOOT', 'FOOTWEAR/HIKING/MENS', '379', '', '{"0": 0}', true),
  ('00000000-0000-0000-0000-000000000001', 'i3', '210000000003', 'LIFE JACKET', 'WATERSPORTS/LIFE JACKETS', '828', '', '{"0": 2, "1": 2}', false);
insert into public.ls_sales (organization_id, sale_id, shop_id, completed, voided) values
  ('00000000-0000-0000-0000-000000000001', 's1', '3', true, false), ('00000000-0000-0000-0000-000000000001', 's2', '1', true, false), ('00000000-0000-0000-0000-000000000001', 's3', '3', false, false), ('00000000-0000-0000-0000-000000000001', 's4', '3', true, true);
insert into public.ls_sale_lines (organization_id, sale_line_id, sale_id, item_id, shop_id, qty, sold_at) values
  ('00000000-0000-0000-0000-000000000001', 'l1', 's1', 'i1', '3', 2, now() - interval '10 days'),
  ('00000000-0000-0000-0000-000000000001', 'l2', 's2', 'i1', '1', 1, now() - interval '20 days'),
  ('00000000-0000-0000-0000-000000000001', 'l3', 's1', 'i1', '3', -1, now() - interval '5 days'),   -- a return
  ('00000000-0000-0000-0000-000000000001', 'l4', 's3', 'i1', '3', 5, now() - interval '3 days'),    -- sale not completed: not counted
  ('00000000-0000-0000-0000-000000000001', 'l5', 's4', 'i1', '3', 5, now() - interval '3 days'),    -- voided: not counted
  ('00000000-0000-0000-0000-000000000001', 'l6', 's1', 'i1', '3', 9, now() - interval '400 days'),  -- outside the period
  ('00000000-0000-0000-0000-000000000001', 'l7', 's2', 'i3', '1', 3, now() - interval '2 days');
select system_sku, vendor_name, vendor_item_id, sold, sold_total, last_sold = (now() - interval '10 days')::date as last_is_the_last_real_sale, archived
  from public.ls_report_rows('00000000-0000-0000-0000-000000000001', (current_date - 365), current_date, array['1','3'], array['379'], null) order by 1;
select system_sku, sold_total from public.ls_report_rows('00000000-0000-0000-0000-000000000001', (current_date - 365), current_date, array['3'], null, array['FOOTWEAR/HIKING']) order by 1;
select system_sku, sold_total from public.ls_report_rows('00000000-0000-0000-0000-000000000001', (current_date - 365), current_date, array['1','3'], null, array['WATERSPORTS']) order by 1;
select * from public.ls_categories('00000000-0000-0000-0000-000000000001');
delete from public.ls_sale_lines where organization_id = '00000000-0000-0000-0000-000000000001';
delete from public.ls_sales where organization_id = '00000000-0000-0000-0000-000000000001';
delete from public.ls_items where organization_id = '00000000-0000-0000-0000-000000000001';
