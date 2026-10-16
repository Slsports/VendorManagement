\set ON_ERROR_STOP on
\pset footer off
\echo '>>> The final confirmed order: row edits are saved, and the order gets the final lines'
reset role;
select set_config('request.jwt.claims', '', false) is not null as service;
insert into public.vendors (organization_id, name) values ('00000000-0000-0000-0000-000000000001', 'Final Test Co') returning id as v \gset
insert into public.orders (organization_id, vendor_id, status, source, order_date) values ('00000000-0000-0000-0000-000000000001', :'v', 'open', 'manual', current_date) returning id as o \gset
insert into public.order_lines (organization_id, order_id, sort_order, vendor_item_id, description, quantity, unit_cost) values ('00000000-0000-0000-0000-000000000001', :'o', 0, 'OLD', 'Old line', 1, 1);
insert into public.vendor_links (organization_id, vendor_id, kind, label, url, file_name, source)
values ('00000000-0000-0000-0000-000000000001', :'v', 'other', 'F1', 'https://x/f1.pdf', 'F1.pdf', 'email') returning id as d \gset
insert into public.order_checks (organization_id, vendor_id, order_id, kind, document_id, status, reading)
values ('00000000-0000-0000-0000-000000000001', :'v', :'o', 'confirmation', :'d', 'to_review', '{"lines":[]}') returning id as c \gset
set role authenticated;
select set_config('request.jwt.claims', '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}', false) is not null as admin_in;
select public.order_check_edit_row(:'c', 'BG81 Air Pad', '{"qty":18}') ? 'BG81 Air Pad' as saved;
select public.order_check_edit_row(:'c', 'QAC-ROCKER Rocker', '{"removed":true}') ->> 'QAC-ROCKER Rocker' as removed_edit;
select public.order_check_edit_row(:'c', 'BG81 Air Pad', '{}') ? 'BG81 Air Pad' as still_there_after_clear;
select public.order_check_save_final(:'c', '[{"item":"BG81","name":"Air Pad","qty":18,"cost":9.5},{"item":"GZ37","name":"Gazebo","qty":24,"cost":50},{"item":"X","name":"Zero","qty":0,"cost":1}]') = :'o' as same_order;
reset role;
select set_config('request.jwt.claims', '', false) is not null as service;
select string_agg(vendor_item_id || ' ' || quantity::int, ', ' order by sort_order) as final_lines from public.order_lines where order_id = :'o';
select est_cost from public.orders where id = :'o';
delete from public.order_checks where id = :'c';
delete from public.vendor_links where id = :'d';
delete from public.order_lines where order_id = :'o';
delete from public.orders where id = :'o';
delete from public.vendors where id = :'v';
