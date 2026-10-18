\set ON_ERROR_STOP on
\pset footer off
\echo '>>> Unavailable items: read from a confirmation, a card for the reviewer, decisions with dated notes, DNR by name'
reset role;
select set_config('request.jwt.claims', '', false) is not null as service;
insert into public.vendors (organization_id, name, lightspeed_vendor_id) values ('00000000-0000-0000-0000-000000000001', 'BECKER TEST - WWD', 'TV265') returning id as v \gset
insert into public.ls_items (organization_id, item_id, description, default_vendor_id, vendor_item_id) values ('00000000-0000-0000-0000-000000000001', 'TI1', 'GRAND SIERRA GLOVE LARGE 71237', 'TV265', '71237');
insert into public.orders (organization_id, vendor_id, po_number) values ('00000000-0000-0000-0000-000000000001', :'v', 'TEST-PO-170') returning id as o \gset
insert into public.vendor_links (organization_id, vendor_id, kind, label, url) values ('00000000-0000-0000-0000-000000000001', :'v', 'confirmation', 'Conf', 'https://example.com/c') returning id as d \gset
insert into public.order_checks (organization_id, vendor_id, order_id, kind, document_id, status, assigned_to)
values ('00000000-0000-0000-0000-000000000001', :'v', :'o', 'confirmation', :'d', 'to_review', '11111111-1111-1111-1111-111111111111') returning id as c \gset
select public.item_changes_from_check(:'c', '[
  {"vendor_item_id": "71237", "item_name": "GRAND SIERRA GLOVE LG", "read_as": "replaced", "sure": true, "replacement_vendor_item_id": "71240", "replacement_name": "GRAND SIERRA GLOVE II LG", "replacement_price": 12.5, "back_date": null, "vendor_words": "71237 disc, replaced by 71240"},
  {"vendor_item_id": "60894", "item_name": "NECK GAITER", "read_as": "out_of_stock", "sure": true, "back_date": "2026-11-15", "vendor_words": "60894 OOS until 11/15"},
  {"vendor_item_id": "33074", "item_name": "CAMO GLOVE", "read_as": "unclear", "sure": false, "vendor_words": "33074 see new styles"}]') as read;
select vendor_item_id, read_as, ls_item_id, ls_name, back_date from public.item_changes where check_id = :'c' order by vendor_item_id;
select count(*) as cards, min(assigned_to::text) as assigned from public.review_items where kind = 'item_change' and entity_id = :'v';
-- a re-read adds no second card
select public.item_changes_from_check(:'c', '[{"vendor_item_id": "71237", "item_name": "GRAND SIERRA GLOVE LG", "read_as": "replaced", "sure": true, "replacement_vendor_item_id": "71240"}]') as reread;
select count(*) as still_three_cards from public.review_items where kind = 'item_change' and entity_id = :'v';
-- a buyer cannot DNR; the admin (can_dnr) can
update public.profiles set can_dnr = true, note_initials = 'DP' where id = '11111111-1111-1111-1111-111111111111';
set role authenticated;
select set_config('request.jwt.claims', '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}', false) is not null as admin_in;
select decision, note_line ~ '^\d{1,2}/\d{1,2}/\d{2} DP: REPLACED WITH 71240$' as dated_note, ls_status from public.item_change_decide((select id from public.item_changes where check_id = :'c' and vendor_item_id = '71237'), 'replacement');
select decision, note_line ~ 'DP: OUT OF STOCK AT VENDOR, BACK 11/15/26$' as back_date_in_note from public.item_change_decide((select id from public.item_changes where check_id = :'c' and vendor_item_id = '60894'), 'out_of_stock');
select decision, note_line ~ 'DP: DNR: POOR QUALITY$' as dnr_note from public.item_change_decide((select id from public.item_changes where check_id = :'c' and vendor_item_id = '33074'), 'dnr', null, 'poor quality');
reset role;
select set_config('request.jwt.claims', '', false) is not null as service;
update public.profiles set can_dnr = false where id = '11111111-1111-1111-1111-111111111111';
set role authenticated;
select set_config('request.jwt.claims', '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}', false) is not null as again_in;
do $$ begin
  perform public.item_change_decide((select id from public.item_changes where vendor_item_id = '33074' limit 1), 'dnr', null, 'x');
  raise notice 'DNR was allowed (wrong)';
exception when insufficient_privilege then raise notice 'DNR refused without can_dnr (right)';
end $$;
reset role;
select set_config('request.jwt.claims', '', false) is not null as service;
select status, count(*) from public.review_items where kind = 'item_change' and entity_id = :'v' group by 1;
select public.item_change_ls_result((select id from public.item_changes where vendor_item_id = '71237' and check_id = :'c'), 'written') is null as recorded;
select ls_status, ls_written_at is not null as when_written from public.item_changes where vendor_item_id = '71237' and check_id = :'c';
-- clean up
update public.profiles set note_initials = null where id = '11111111-1111-1111-1111-111111111111';
delete from public.item_changes where check_id = :'c';
delete from public.review_items where kind = 'item_change' and entity_id = :'v';
delete from public.order_checks where id = :'c';
delete from public.vendor_links where id = :'d';
delete from public.orders where id = :'o';
delete from public.ls_items where item_id = 'TI1';
delete from public.vendors where id = :'v';
