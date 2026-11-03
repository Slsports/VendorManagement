\set ON_ERROR_STOP on
\pset footer off
\echo '>>> 0289: a revised confirmation replaces the earlier one; backorders follow the newest paper; delay tasks close'
reset role;
select set_config('request.jwt.claims', '', false) is not null as service;
select public.paper_key('12345-R1') = '12345' as rev_r, public.paper_key('12345 Rev 2') = '12345' as rev_word, public.paper_key('SR12345') = 'SR12345' as keeps_r,
       public.paper_key('SO 88198-2') <> public.paper_key('SO 88198-3') as split_shipments_differ;
select id as admin_id from public.profiles where organization_id = '00000000-0000-0000-0000-000000000001' and role = 'admin' and is_active order by created_at limit 1 \gset
insert into public.vendors (organization_id, name) values ('00000000-0000-0000-0000-000000000001', 'NW289') returning id as v \gset
insert into public.orders (organization_id, vendor_id, po_number, status) values ('00000000-0000-0000-0000-000000000001', :'v', 'NW289', 'confirmed') returning id as o \gset
insert into public.vendor_links (organization_id, vendor_id, kind, label, storage_path, file_name, order_id, doc_number, doc_date)
values ('00000000-0000-0000-0000-000000000001', :'v', 'confirmation', 'first', 'x/nw289-a.pdf', 'a.pdf', :'o', '5550', date '2026-09-01') returning id as l1 \gset
select id as c1 from public.order_checks where document_id = :'l1' \gset
update public.order_checks set status = 'comparing', doc_number = '5550', doc_date = date '2026-09-01', kind = 'confirmation' where id = :'c1';
select public.item_changes_from_check(:'c1', '[{"vendor_item_id":"A-1","read_as":"backordered","vendor_words":"A-1 on backorder"},{"vendor_item_id":"B-2","read_as":"discontinued","vendor_words":"B-2 discontinued"}]'::jsonb) = 2 as first_read;
update public.order_checks set status = 'to_review' where id = :'c1';
select public.order_check_newer_wins(:'c1') like 'replaced 0%' as nothing_to_replace_yet;
select backorder as order_on_backorder from public.orders where id = :'o';
insert into public.tasks (organization_id, title, due_date, order_id, auto_key, assigned_to) values ('00000000-0000-0000-0000-000000000001', 'NW289: backorders or shipping delays', current_date, :'o', 'shipupd:nw289', :'admin_id') returning id as t \gset

\echo '>>> the revised confirmation (same number, later date) has nothing on backorder'
insert into public.vendor_links (organization_id, vendor_id, kind, label, storage_path, file_name, order_id, doc_number, doc_date)
values ('00000000-0000-0000-0000-000000000001', :'v', 'confirmation', 'revised', 'x/nw289-b.pdf', 'b.pdf', :'o', '5550-R1', date '2026-09-10') returning id as l2 \gset
select id as c2 from public.order_checks where document_id = :'l2' \gset
update public.order_checks set status = 'to_review', doc_number = '5550-R1', doc_date = date '2026-09-10', kind = 'confirmation' where id = :'c2';
select public.order_check_newer_wins(:'c2') = 'replaced 1, backorders cleared 0, tasks closed 1' as newer_wins;
select status = 'dismissed' and read_note like 'Replaced by the newer NW289''s confirmation 5550-R1 of Sep 10, 2026%' as old_check_closed from public.order_checks where id = :'c1';
select superseded_at is not null and not is_current as old_paper_to_old from public.vendor_links where id = :'l1';
select (select status from public.review_items where id = ic.review_item_id) = 'accepted' as old_card_closed from public.item_changes ic where ic.check_id = :'c1' and ic.item_key = 'B-2';
select not backorder as backorder_cleared from public.orders where id = :'o';
select done_at is not null and closed_how = 'vms' and done_note like 'Closed by VMS: the newer%' as delay_task_closed from public.tasks where id = :'t';

\echo '>>> an older paper read late does not undo the newer one'
insert into public.vendor_links (organization_id, vendor_id, kind, label, storage_path, file_name, order_id, doc_number, doc_date)
values ('00000000-0000-0000-0000-000000000001', :'v', 'confirmation', 'old copy', 'x/nw289-c.pdf', 'c.pdf', :'o', '5550', date '2026-08-30') returning id as l3 \gset
select id as c3 from public.order_checks where document_id = :'l3' \gset
update public.order_checks set status = 'to_review', doc_number = '5550', doc_date = date '2026-08-30', kind = 'confirmation' where id = :'c3';
select public.order_check_newer_wins(:'c3') is not null as ran;
select (select status from public.order_checks where id = :'c3') = 'dismissed' as late_old_dismissed,
       (select status from public.order_checks where id = :'c2') = 'to_review' as newer_stays;

\echo '>>> a delay task closes when the order ships with nothing on backorder'
insert into public.tasks (organization_id, title, due_date, order_id, auto_key, assigned_to) values ('00000000-0000-0000-0000-000000000001', 'NW289 again', current_date, :'o', 'shipupd:nw289b', :'admin_id') returning id as t2 \gset
update public.orders set status = 'shipped' where id = :'o';
select done_at is not null and done_note = 'Closed by VMS: the order is shipped with nothing on backorder.' as closed_on_ship from public.tasks where id = :'t2';

delete from public.tasks where id in (:'t', :'t2');
delete from public.review_items where id in (select review_item_id from public.item_changes where check_id in (:'c1', :'c2', :'c3'));
delete from public.item_changes where check_id in (:'c1', :'c2', :'c3');
delete from public.order_checks where order_id = :'o';
delete from public.vendor_links where order_id = :'o';
delete from public.orders where id = :'o';
delete from public.vendors where id = :'v';
