\set ON_ERROR_STOP on
\pset footer off
\echo '>>> Credits go to Credits; the same document is kept once'
reset role;
select set_config('request.jwt.claims', '', false) is not null as service;
insert into public.vendors (organization_id, name) values ('00000000-0000-0000-0000-000000000001', 'Dedupe Sports') returning id as v \gset
insert into public.orders (organization_id, vendor_id, status, po_number, order_date, source) values ('00000000-0000-0000-0000-000000000001', :'v', 'open', 'DD100', current_date, 'email') returning id as o \gset
\echo '>>> 1. a credit memo filed as an invoice'
insert into public.vendor_links (organization_id, vendor_id, kind, label, storage_path, file_name, received_at, source)
values ('00000000-0000-0000-0000-000000000001', :'v', 'invoice', 'C1', 'x/C1.pdf', 'C1.pdf', current_date, 'email') returning id as cm \gset
select public.order_check_apply_read((select id from public.order_checks where document_id = :'cm'), '{"doc_type":"credit","doc_number":"CM1","total":"-71.70","note":"50% refund"}') as result;
select l.kind, c.status, left(c.read_note, 33) note from public.vendor_links l join public.order_checks c on c.document_id = l.id where l.id = :'cm';
\echo '>>> 2. the same invoice filed twice (two emails): the second copy goes, its attachment points at the first'
insert into public.vendor_links (organization_id, vendor_id, kind, label, storage_path, file_name, file_size, received_at, source, order_id, doc_number, doc_total)
values ('00000000-0000-0000-0000-000000000001', :'v', 'invoice', 'I9', 'x/I9.pdf', 'I9.pdf', 100, current_date, 'email', :'o', 'I9', 50) returning id as first \gset
insert into public.vendor_links (organization_id, vendor_id, kind, label, storage_path, file_name, file_size, received_at, source)
values ('00000000-0000-0000-0000-000000000001', :'v', 'invoice', 'Invoice_I9', 'x/I9b.pdf', 'Invoice_I9.pdf', 120, current_date, 'email') returning id as second \gset
insert into public.email_threads (organization_id, gmail_thread_id) values ('00000000-0000-0000-0000-000000000001', 'dd-t') returning id as t \gset
insert into public.emails (organization_id, thread_id, gmail_id, direction, from_email, received_at, vendor_id) values ('00000000-0000-0000-0000-000000000001', :'t', 'dd-1', 'in', 'a@dd.example', now(), :'v') returning id as e \gset
insert into public.email_attachments (organization_id, email_id, file_name, vendor_link_id) values ('00000000-0000-0000-0000-000000000001', :'e', 'Invoice_I9.pdf', :'second');
select public.order_check_apply_read((select id from public.order_checks where document_id = :'second'), '{"doc_type":"invoice","doc_number":"I-9","total":"50"}') as result;
select count(*) as copies_left, bool_and(id = :'first') as kept_first from public.vendor_links where vendor_id = :'v' and kind = 'invoice';
select vendor_link_id = :'first' as attachment_moved from public.email_attachments where email_id = :'e';
\echo '>>> 3. the same file saved three times: one stays'
insert into public.vendor_links (organization_id, vendor_id, kind, label, storage_path, file_name, file_size, received_at, source)
select '00000000-0000-0000-0000-000000000001', :'v', 'catalog', 'Cat', 'x/cat' || g || '.pdf', 'Catalog.pdf', 999, current_date, 'email' from generate_series(1, 3) g;
select public.vendor_links_dedupe(:'v') as removed;
select count(*) as catalogs from public.vendor_links where vendor_id = :'v' and kind = 'catalog';
delete from public.email_attachments where email_id = :'e';
delete from public.emails where id = :'e';
delete from public.email_threads where id = :'t';
delete from public.order_checks where vendor_id = :'v';
delete from public.vendor_links where vendor_id = :'v';
delete from public.ls_pos where vendor_id = :'v';
delete from public.orders where vendor_id = :'v';
delete from public.vendors where id = :'v';
