\set ON_ERROR_STOP on
\pset footer off
\echo '>>> Order paperwork: a confirmation file starts a check, finds the order by PO, goes to whoever placed it'
reset role;
select id as admin_id from public.profiles where organization_id = '00000000-0000-0000-0000-000000000001' and role = 'admin' and is_active order by created_at limit 1 \gset
insert into public.vendors (organization_id, name) values ('00000000-0000-0000-0000-000000000001', 'Paperwork Test Co') returning id as v \gset
insert into public.orders (organization_id, vendor_id, status, order_date, po_number, est_cost, placed_by, source, source_key)
  values ('00000000-0000-0000-0000-000000000001', :'v', 'open', current_date - 10, 'SLS-4471', 1200, 'D&J', 'manual', 'pw-1') returning id as o1 \gset
insert into public.orders (organization_id, vendor_id, status, order_date, est_cost, placed_by, source, source_key)
  values ('00000000-0000-0000-0000-000000000001', :'v', 'open', current_date - 5, 300, 'JARRETT', 'manual', 'pw-2') returning id as o2 \gset
select public.order_reviewer(:'o1') = :'admin_id' as dj_goes_to_admin;
insert into public.vendor_links (organization_id, vendor_id, kind, label, storage_path) values ('00000000-0000-0000-0000-000000000001', :'v', 'confirmation', 'SO 991', 'x/so991.pdf') returning id as d1 \gset
select status, kind from public.order_checks where document_id = :'d1';
select id as c1 from public.order_checks where document_id = :'d1' \gset
select public.order_check_apply_read(:'c1', '{"doc_type":"confirmation","po_number":"sls 4471","doc_number":"SO991","doc_date":"2026-10-01","total":1210.5}') as by_po;
select status, order_id = :'o1' as right_order, assigned_to = :'admin_id' as to_admin, doc_total from public.order_checks where id = :'c1';
select order_id = :'o1' as doc_on_order from public.vendor_links where id = :'d1';
\echo '--- an invoice with no PO: the order whose cost is within 3%'
insert into public.vendor_links (organization_id, vendor_id, kind, label, storage_path) values ('00000000-0000-0000-0000-000000000001', :'v', 'invoice', 'INV 5', 'x/inv5.pdf') returning id as d2 \gset
select id as c2 from public.order_checks where document_id = :'d2' \gset
select public.order_check_apply_read(:'c2', '{"doc_type":"confirmation","total":305}') as by_total;
select kind, order_id = :'o2' as right_order from public.order_checks where id = :'c2';
select kind as refiled from public.vendor_links where id = :'d2';
\echo '--- not paperwork; no order found'
insert into public.vendor_links (organization_id, vendor_id, kind, label, storage_path) values ('00000000-0000-0000-0000-000000000001', :'v', 'invoice', 'stmt', 'x/st.pdf') returning id as d3 \gset
select public.order_check_apply_read((select id from public.order_checks where document_id = :'d3'), '{"doc_type":"other","note":"A statement"}') as other;
insert into public.vendor_links (organization_id, vendor_id, kind, label, storage_path) values ('00000000-0000-0000-0000-000000000001', :'v', 'invoice', 'inv 9', 'x/i9.pdf') returning id as d4 \gset
select public.order_check_apply_read((select id from public.order_checks where document_id = :'d4'), '{"doc_type":"invoice","total":77777}') as unknown;
\echo '--- compare, then the reviewer marks it looked at: the order is confirmed'
select public.order_check_apply_compare(:'c1', '{"summary":"All matches","rows":[],"issues":[],"against":"Our PO email"}');
select status, result from public.order_checks where id = :'c1';
set role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', :'admin_id', 'role', 'authenticated')::text, false) is not null as as_admin;
select count(*) as can_read from public.order_checks where id = :'c1';
select public.order_check_action(:'c1', 'done');
reset role;
select c.status, c.outcome, o.status as order_status from public.order_checks c join public.orders o on o.id = c.order_id where c.id = :'c1';
