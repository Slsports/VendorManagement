\set ON_ERROR_STOP on
\pset footer off
\echo '>>> Confirmations without an order: matching, the sales report, the PO task and email'
reset role;
select set_config('request.jwt.claims', '', false) is not null as service;
select public.is_real_po('B671437') as real, public.is_real_po('N/A') as na, public.is_real_po(null) as nothing;
insert into public.vendors (organization_id, name, email) values ('00000000-0000-0000-0000-000000000001', 'Confirm Test Sports', 'sales@confirm.example') returning id as v \gset
insert into public.orders (organization_id, vendor_id, status, po_number, order_date, est_cost, source) values ('00000000-0000-0000-0000-000000000001', :'v', 'open', 'CW100', current_date - 20, 500, 'email') returning id as o1 \gset
insert into public.orders (organization_id, vendor_id, status, order_date, source, placed_by_id) values ('00000000-0000-0000-0000-000000000001', :'v', 'open', current_date - 30, 'email', '22222222-2222-2222-2222-222222222222') returning id as o2 \gset
insert into public.email_threads (organization_id, gmail_thread_id) values ('00000000-0000-0000-0000-000000000001', 'cw-t1') returning id as t \gset
insert into public.emails (organization_id, thread_id, gmail_id, direction, from_email, subject, body_text, received_at, vendor_id)
values ('00000000-0000-0000-0000-000000000001', :'t', 'cw-1', 'in', 'maria@confirm.example', 'Shaver Lake - S102112', 'Please review the sales order', now(), :'v') returning id as e \gset
insert into public.vendor_emails (organization_id, vendor_id, email, contact_name) values ('00000000-0000-0000-0000-000000000001', :'v', 'maria@confirm.example', 'Maria Calderon');
-- a sales report filed 10 days before
insert into public.vendor_links (organization_id, vendor_id, kind, label, storage_path, file_name, received_at, source)
values ('00000000-0000-0000-0000-000000000001', :'v', 'sales_report', 'CW Sales 365', 'x/cw.xlsx', 'cw.xlsx', current_date - 10, 'manual') returning id as rep \gset
-- the confirmation (filing it starts a check)
insert into public.vendor_links (organization_id, vendor_id, kind, label, storage_path, file_name, received_at, source, email_id)
values ('00000000-0000-0000-0000-000000000001', :'v', 'confirmation', 'S102112', 'x/S102112.pdf', 'S102112.pdf', current_date, 'email', :'e') returning id as doc \gset
select id as c from public.order_checks where document_id = :'doc' \gset

\echo '>>> 1. with our PO it finds the order'
select how, order_id = :'o1' as right_order from public.order_check_match(:'c', '{"doc_type":"confirmation","po_number":"cw-100","doc_number":"S1"}');
\echo '>>> 2. no PO, nothing else: compared with the closest sales report, not ticked; a Create PO task'
select public.order_check_apply_read(:'c', '{"doc_type":"confirmation","po_number":null,"doc_number":"S102112","total":null,"lines":[]}') as result;
select c.status, c.report_id = :'rep' as report, c.report_ticked, t.title, t.done_at is null as task_open
  from public.order_checks c join public.tasks t on t.id = c.po_task_id where c.id = :'c';
\echo '>>> 3. as a buyer: tick the report, pick the order (no PO yet), then type the PO on the order'
set role authenticated;
select set_config('request.jwt.claims', '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}', false) is not null as signed_in;
select public.order_check_action(:'c', 'tick_report');
select public.order_check_action(:'c', 'set_order', :'o2');
reset role;
select set_config('request.jwt.claims', '', false) is not null as service;
select c.report_ticked, l.report_used_at is not null as ticked_in_folder, c.po_draft_id is null as no_email_yet, c.match_how from public.order_checks c join public.vendor_links l on l.id = c.report_id where c.id = :'c';
update public.orders set po_number = 'CW200' where id = :'o2';
select d.to_emails, d.subject, d.body like 'Hi Maria,%CW200%' as asks_for_po, d.owner_id = '22222222-2222-2222-2222-222222222222' as to_placer, t.done_at is not null as task_done
  from public.order_checks c join public.email_drafts d on d.id = c.po_draft_id join public.tasks t on t.id = c.po_task_id where c.id = :'c';
\echo '>>> 4. ticking another report from the same season unticks the first'
insert into public.vendor_links (organization_id, vendor_id, kind, label, storage_path, file_name, received_at, source)
values ('00000000-0000-0000-0000-000000000001', :'v', 'sales_report', 'CW Sales v2', 'x/cw2.xlsx', 'cw2.xlsx', current_date - 5, 'manual') returning id as rep2 \gset
select public.sales_report_tick(:'rep2', true, :'o2');
select label, report_used_at is not null as ticked from public.vendor_links where vendor_id = :'v' and kind = 'sales_report' order by label;
select sales_report_id = :'rep2' as order_report from public.orders where id = :'o2';
\echo '>>> 5. a document filed from an email that is not paperwork moves to Other'
insert into public.vendor_links (organization_id, vendor_id, kind, label, storage_path, file_name, received_at, source, email_id)
values ('00000000-0000-0000-0000-000000000001', :'v', 'confirmation', 'flyer', 'x/flyer.pdf', 'flyer.pdf', current_date, 'email', :'e') returning id as doc2 \gset
select public.order_check_apply_read((select id from public.order_checks where document_id = :'doc2'), '{"doc_type":"other","note":"A flyer"}') as result;
select l.kind, c.status from public.vendor_links l join public.order_checks c on c.document_id = l.id where l.id = :'doc2';

delete from public.email_drafts where vendor_id = :'v';
delete from public.tasks where vendor_id = :'v';
delete from public.order_checks where vendor_id = :'v';
update public.orders set sales_report_id = null where vendor_id = :'v';
delete from public.vendor_links where vendor_id = :'v';
delete from public.vendor_emails where vendor_id = :'v';
delete from public.emails where gmail_id like 'cw-%';
delete from public.email_threads where id = :'t';
delete from public.ls_pos where vendor_id = :'v';
delete from public.orders where vendor_id = :'v';
delete from public.vendors where id = :'v';
