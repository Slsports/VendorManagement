\set ON_ERROR_STOP on
\pset footer off
\echo '>>> 0274: backordered items go on the order, no card; other unavailable items still make a card'
reset role;
select set_config('request.jwt.claims', '', false) is not null as service;
insert into public.vendors (organization_id, name) values ('00000000-0000-0000-0000-000000000001', 'BO274') returning id as v \gset
insert into public.orders (organization_id, vendor_id, po_number, status) values ('00000000-0000-0000-0000-000000000001', :'v', 'BO274', 'confirmed') returning id as o \gset
insert into public.vendor_links (organization_id, vendor_id, kind, label, storage_path, file_name, received_at, order_id)
values ('00000000-0000-0000-0000-000000000001', :'v', 'other', 'sheet', 'x/bo274.xlsx', 'bo274.xlsx', current_date, :'o') returning id as l \gset
insert into public.order_checks (organization_id, vendor_id, order_id, kind, document_id, status) values ('00000000-0000-0000-0000-000000000001', :'v', :'o', 'confirmation', :'l', 'comparing') returning id as c \gset
select public.item_changes_from_check(:'c', '[{"vendor_item_id":"A-1","read_as":"backordered","vendor_words":"Backordered: A-1 qty 12"},{"vendor_item_id":"B-2","read_as":"discontinued","vendor_words":"B-2 discontinued"}]'::jsonb) = 2 as two_saved;
select review_item_id is null and order_id = :'o' as backorder_no_card from public.item_changes where check_id = :'c' and item_key = 'A-1';
select review_item_id is not null as discontinued_card from public.item_changes where check_id = :'c' and item_key = 'B-2';
select backorder as order_marked from public.orders where id = :'o';
delete from public.review_items where id in (select review_item_id from public.item_changes where check_id = :'c');
delete from public.item_changes where check_id = :'c';
delete from public.order_checks where id = :'c';
delete from public.vendor_links where id = :'l';
delete from public.orders where id = :'o';
delete from public.vendors where id = :'v';
