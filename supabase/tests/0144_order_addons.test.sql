\set ON_ERROR_STOP on
\pset footer off
\echo '>>> Add-ons: lines added to a confirmed order mark the day and ask for a new confirmation; shipping closes add-ons'
reset role;
select set_config('request.jwt.claims', '', false) is not null as claims_cleared;
select id as vendor_id from public.vendors where organization_id = '00000000-0000-0000-0000-000000000001' order by created_at limit 1 \gset
insert into public.orders (organization_id, vendor_id, status, order_date, po_number, est_cost, addons) values ('00000000-0000-0000-0000-000000000001', :'vendor_id', 'confirmed', current_date - 5, 'SLS101126', 100, 'yes') returning id as ord \gset
insert into public.order_lines (organization_id, order_id, sort_order, vendor_item_id, description, quantity, unit_cost) values ('00000000-0000-0000-0000-000000000001', :'ord', 1, 'A1', 'ORIGINAL ITEM', 2, 10);
select public.order_add_lines(:'ord', '[{"vendor_item_id":"B2","description":"ADD-ON ITEM","quantity":3,"unit_cost":5},{"vendor_item_id":"C3","description":"NOTHING","quantity":0}]'::jsonb) as lines_added;
select description, quantity, added_on = current_date as added_today, sort_order from public.order_lines where order_id = :'ord' order by sort_order;
select status, est_cost from public.orders where id = :'ord';
update public.orders set status = 'shipped' where id = :'ord';
select addons as addons_after_shipping from public.orders where id = :'ord';
do $$ begin
  perform public.order_add_lines((select id from public.orders where po_number = 'SLS101126'), '[{"description":"LATE","quantity":1}]'::jsonb);
  raise exception 'a shipped order took an add-on';
exception when others then if sqlerrm not like '%shipped%' then raise; end if; end $$;
delete from public.orders where id = :'ord';
