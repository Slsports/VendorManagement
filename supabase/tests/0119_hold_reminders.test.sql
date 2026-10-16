\set ON_ERROR_STOP on
\pset footer off
\echo '>>> A vendor on hold gets a look-again task; no Create PO task for old papers or vendors on hold'
reset role;
select set_config('request.jwt.claims', '', false) is not null as service;
insert into public.vendors (organization_id, name, standing, standing_review_date, do_not_order_reason)
values ('00000000-0000-0000-0000-000000000001', 'Hold Test Toys', 'hold', '2027-01-18', 'Count the inventory first.') returning id as v \gset
select title, due_date, notes like '%Count the inventory%' as has_note from public.tasks where vendor_id = :'v' and done_at is null;
update public.vendors set standing_review_date = '2027-02-01' where id = :'v';
select count(*) filter (where done_at is null) as open_tasks, max(due_date) filter (where done_at is null) as moved_to from public.tasks where vendor_id = :'v';
update public.vendors set standing = 'ok' where id = :'v';
select count(*) filter (where done_at is null) as open_after_ok from public.tasks where vendor_id = :'v';
-- a confirmation without our PO, vendor on hold: no Create PO task, the check goes to the admin
update public.vendors set standing = 'hold' where id = :'v';
insert into public.vendor_links (organization_id, vendor_id, kind, label, url, file_name, source)
values ('00000000-0000-0000-0000-000000000001', :'v', 'other', 'C1', 'https://x/c1.pdf', 'C1.pdf', 'email') returning id as d \gset
insert into public.order_checks (organization_id, vendor_id, kind, document_id, status, doc_date, reading)
values ('00000000-0000-0000-0000-000000000001', :'v', 'confirmation', :'d', 'to_review', current_date, '{"po_number":null,"lines":[]}') returning id as c \gset
select public.order_check_po_followup(:'c') as on_hold_result;
-- vendor fine to order, but the paper is two months old
update public.vendors set standing = 'ok' where id = :'v';
update public.order_checks set doc_date = current_date - 60 where id = :'c';
select public.order_check_po_followup(:'c') as old_paper_result;
select count(*) as create_po_tasks from public.tasks where vendor_id = :'v' and auto_key like 'create_po:%';
delete from public.order_checks where id = :'c';
delete from public.vendor_links where id = :'d';
delete from public.tasks where vendor_id = :'v';
delete from public.vendors where id = :'v';
