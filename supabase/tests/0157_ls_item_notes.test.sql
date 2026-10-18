\set ON_ERROR_STOP on
\pset footer off
\echo '>>> Item Notes: the copy keeps each item''s LS note and the report rows return it'
reset role;
insert into public.ls_items (organization_id, item_id, system_sku, description, category_path, default_vendor_id, vendor_item_id, qoh, note, note_public) values
  ('00000000-0000-0000-0000-000000000001', '9001', '210009001', '*BECKER OLD STYLE', 'TOYS', '265', '63300', '{"3": 2}', 'REPLACED WITH 63360', false),
  ('00000000-0000-0000-0000-000000000001', '9002', '210009002', 'BECKER NEW STYLE', 'TOYS', '265', '63360', '{"3": 0}', '', false);
select system_sku, note, note_public from public.ls_report_rows('00000000-0000-0000-0000-000000000001', (current_date - 365), current_date, array['3'], array['265'], null) order by 1;
delete from public.ls_items where organization_id = '00000000-0000-0000-0000-000000000001' and item_id in ('9001', '9002');
