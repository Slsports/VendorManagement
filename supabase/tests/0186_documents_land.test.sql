\set ON_ERROR_STOP on
\pset footer off
\echo '>>> Documents land: realtime tables, proof task, credit task, packing slip ships the order, LS PO tied'
reset role;
select set_config('request.jwt.claims', '', false) is not null as service;
select count(*) as published from pg_publication_tables where pubname = 'supabase_realtime' and tablename in ('vendor_links', 'order_checks', 'accounting_documents', 'sales_reports', 'review_items');
insert into public.vendors (organization_id, name, assigned_buyer_id) values ('00000000-0000-0000-0000-000000000001', 'Landing Test Co', '11111111-1111-1111-1111-111111111111') returning id as v \gset
insert into public.orders (organization_id, vendor_id, status, po_number, order_date, placed_by_id) values ('00000000-0000-0000-0000-000000000001', :'v', 'confirmed', 'PO-9191', current_date - 10, '11111111-1111-1111-1111-111111111111') returning id as o \gset
-- a proof lands: a task for the orderer
insert into public.vendor_links (organization_id, vendor_id, kind, label, file_name, storage_path, source) values ('00000000-0000-0000-0000-000000000001', :'v', 'proof', 'Hat logo proof', 'hat_PROOF.pdf', 'x/proof.pdf', 'email') returning id as p \gset
select title, due_date = current_date + 3 as three_days, assigned_to::text = '11111111-1111-1111-1111-111111111111' as to_buyer, done_at is null as open from public.tasks where auto_key = 'proof:' || :'p';
-- approving it finishes the task
update public.vendor_links set kind = 'approved_proof', approved_at = now() where id = :'p';
select done_at is not null as done, done_note from public.tasks where auto_key = 'proof:' || :'p';
-- a credit lands: filed and Received, no task (0254)
insert into public.vendor_links (organization_id, vendor_id, kind, label, file_name, storage_path, source) values ('00000000-0000-0000-0000-000000000001', :'v', 'credit', 'CM 4411', 'cm4411.pdf', 'x/cm.pdf', 'email') returning id as c \gset
select count(*) = 0 as no_credit_task from public.tasks where auto_key = 'credit:' || :'c';
-- removing the credit drops the task
delete from public.vendor_links where id = :'c';
select count(*) as credit_tasks_left from public.tasks where auto_key = 'credit:' || :'c';
-- a packing slip with the PO number lands: tied to the order, which moves to Shipped
insert into public.vendor_links (organization_id, vendor_id, kind, label, file_name, storage_path, source, doc_number) values ('00000000-0000-0000-0000-000000000001', :'v', 'packing_slip', 'Packing slip', 'ps.pdf', 'x/ps.pdf', 'email', 'PO-9191') returning id as ps \gset
select order_id = :'o' as tied from public.vendor_links where id = :'ps';
select status from public.orders where id = :'o';
select to_status from public.order_status_history where order_id = :'o' order by changed_at desc limit 1;
-- an LS PO with the LS number lands: tied through ls_pos
insert into public.ls_pos (organization_id, order_id, vendor_id, status, ls_po_number, lines) values ('00000000-0000-0000-0000-000000000001', :'o', :'v', 'sent', 'LS-77', '[]') returning id as lp \gset
insert into public.vendor_links (organization_id, vendor_id, kind, label, file_name, storage_path, source, doc_number) values ('00000000-0000-0000-0000-000000000001', :'v', 'ls_po', 'LS PO', 'lspo.pdf', 'x/lspo.pdf', 'email', 'LS 77') returning id as lpl \gset
select order_id = :'o' as tied_by_ls_number from public.vendor_links where id = :'lpl';
-- a confirmation makes its check; the kick trigger never blocks the insert without pg_net
insert into public.vendor_links (organization_id, vendor_id, kind, label, file_name, storage_path, source) values ('00000000-0000-0000-0000-000000000001', :'v', 'confirmation', 'Conf', 'conf.pdf', 'x/conf.pdf', 'email') returning id as cf \gset
select status from public.order_checks where document_id = :'cf';
-- clean up
delete from public.tasks where auto_key in ('proof:' || :'p', 'credit:' || :'c');
delete from public.order_checks where document_id = :'cf';
delete from public.vendor_links where vendor_id = :'v';
delete from public.ls_pos where id = :'lp';
delete from public.order_status_history where order_id = :'o';
delete from public.orders where id = :'o';
delete from public.vendors where id = :'v';
