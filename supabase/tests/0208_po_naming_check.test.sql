\set ON_ERROR_STOP on
\pset footer off
\echo '>>> The PO on a confirmation: ours, in our naming, missing, someone else''s, or off our naming'
reset role;
select set_config('request.jwt.claims', '', false) is not null as service;
insert into public.vendors (organization_id, name, po_code, email) values ('00000000-0000-0000-0000-000000000001', 'PO208 YAKTEST', 'YAKT', 'po208@example.com') returning id as v \gset
insert into public.orders (organization_id, vendor_id, status, po_number, order_date) values ('00000000-0000-0000-0000-000000000001', :'v', 'open', 'YAKT101226', current_date) returning id as o1 \gset
insert into public.orders (organization_id, vendor_id, status, order_date) values ('00000000-0000-0000-0000-000000000001', :'v', 'open', current_date) returning id as o2 \gset
insert into public.vendor_links (organization_id, vendor_id, kind, label, url) values ('00000000-0000-0000-0000-000000000001', :'v', 'confirmation', 'C1', 'https://example.com/c1') returning id as d1 \gset
insert into public.vendor_links (organization_id, vendor_id, kind, label, url) values ('00000000-0000-0000-0000-000000000001', :'v', 'confirmation', 'C2', 'https://example.com/c2') returning id as d2 \gset
insert into public.vendor_links (organization_id, vendor_id, kind, label, url) values ('00000000-0000-0000-0000-000000000001', :'v', 'confirmation', 'C3', 'https://example.com/c3') returning id as d3 \gset
insert into public.vendor_links (organization_id, vendor_id, kind, label, url) values ('00000000-0000-0000-0000-000000000001', :'v', 'confirmation', 'C4', 'https://example.com/c4') returning id as d4 \gset
insert into public.vendor_links (organization_id, vendor_id, kind, label, url) values ('00000000-0000-0000-0000-000000000001', :'v', 'confirmation', 'C5', 'https://example.com/c5') returning id as d5 \gset
insert into public.order_checks (organization_id, vendor_id, document_id, kind, status, order_id, po_number, reading, doc_date) values
  ('00000000-0000-0000-0000-000000000001', :'v', :'d1', 'confirmation', 'to_review', :'o1', 'yakt-101226 early buy', '{"po_number":"yakt-101226 early buy"}', current_date) returning id as c_ours \gset
insert into public.order_checks (organization_id, vendor_id, document_id, kind, status, order_id, po_number, reading, doc_date) values
  ('00000000-0000-0000-0000-000000000001', :'v', :'d2', 'confirmation', 'to_review', :'o1', '1250540', '{"po_number":"1250540"}', current_date) returning id as c_not \gset
insert into public.order_checks (organization_id, vendor_id, document_id, kind, status, order_id, po_number, reading, doc_date) values
  ('00000000-0000-0000-0000-000000000001', :'v', :'d3', 'confirmation', 'to_review', :'o2', 'NCDXZQN3DZ', '{"po_number":"NCDXZQN3DZ"}', current_date) returning id as c_off \gset
insert into public.order_checks (organization_id, vendor_id, document_id, kind, status, order_id, po_number, reading, doc_date) values
  ('00000000-0000-0000-0000-000000000001', :'v', :'d4', 'confirmation', 'to_review', :'o2', 'YAKT101326', '{"po_number":"YAKT101326"}', current_date) returning id as c_fits \gset
insert into public.order_checks (organization_id, vendor_id, document_id, kind, status, order_id, reading, doc_date) values
  ('00000000-0000-0000-0000-000000000001', :'v', :'d5', 'confirmation', 'to_review', :'o2', '{"po_number":null}', current_date) returning id as c_miss \gset

select public.po_check_state(:'c_ours') = 'ours' and public.po_check_state(:'c_not') = 'not_ours' and public.po_check_state(:'c_off') = 'off'
   and public.po_check_state(:'c_fits') = 'fits' and public.po_check_state(:'c_miss') = 'missing' as states;
select public.order_check_po_followup(:'c_ours') is null and public.order_check_po_followup(:'c_fits') is null as ours_and_fits_need_nothing;
-- someone else's PO on an order with ours: the email asking them to change it
select public.order_check_po_followup(:'c_not') = 'drafted' as not_ours_drafted;
select d.body like '%our PO number YAKT101226 (your confirmation shows 1250540)%' and d.note like '%not ours%' as draft_text
  from public.email_drafts d join public.order_checks c on c.po_draft_id = d.id where c.id = :'c_not';
-- off our naming, and missing, on an order with no PO: the Create PO task
select public.order_check_po_followup(:'c_off') = 'task' and public.order_check_po_followup(:'c_miss') = 'task' as tasks_made;
select notes like '%shows PO NCDXZQN3DZ, which isn''t ours%' as task_text from public.tasks where auto_key = 'create_po:' || :'c_off';

delete from public.tasks where auto_key in ('create_po:' || :'c_off', 'create_po:' || :'c_miss');
update public.order_checks set po_draft_id = null where vendor_id = :'v';
delete from public.email_drafts where vendor_id = :'v';
delete from public.order_checks where vendor_id = :'v';
delete from public.orders where vendor_id = :'v';
delete from public.vendor_links where vendor_id = :'v';
delete from public.vendors where id = :'v';
