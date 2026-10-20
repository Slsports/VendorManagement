\set ON_ERROR_STOP on
\pset footer off
\echo '>>> Invoice Uploads: uploaders see only their own; the store from the invoice; filed once; Needs a look; Bill.com'
reset role;
select set_config('request.jwt.claims', '', false) is not null as service;
insert into auth.users (id, email) values ('88888888-8888-8888-8888-888888888215', 'scan215@example.com') on conflict do nothing;
insert into public.profiles (id, organization_id, email, full_name, role)
values ('88888888-8888-8888-8888-888888888215', '00000000-0000-0000-0000-000000000001', 'scan215@example.com', 'Cat Scanner', 'uploader')
on conflict (id) do update set role = 'uploader', full_name = 'Cat Scanner';
insert into public.vendors (organization_id, name, invoice_store_aliases) values ('00000000-0000-0000-0000-000000000001', 'MILK215', '{"Town Store": "SLS", "Camp Store": "GS", "Marina": "SLM"}') returning id as v \gset
insert into public.vendors (organization_id, name, billcom_send) values ('00000000-0000-0000-0000-000000000001', 'BAIT215', true) returning id as b \gset

-- the store: the vendor's alias, else our codes and aliases
select public.store_for_invoice('00000000-0000-0000-0000-000000000001', :'v', 'TOWN STORE #1') = 'SLS'
   and public.store_for_invoice('00000000-0000-0000-0000-000000000001', :'v', 'Camp Store') = 'GS'
   and public.store_for_invoice('00000000-0000-0000-0000-000000000001', :'b', 'Shaver Lake Marina') = 'SLM'
   and public.store_for_invoice('00000000-0000-0000-0000-000000000001', :'b', 'Happy Camper') = 'GS'
   and public.store_for_invoice('00000000-0000-0000-0000-000000000001', :'b', 'Camp Store') is null as store_names;

-- the uploader: nothing of VMS, only their own
set role authenticated;
select set_config('request.jwt.claims', '{"sub":"88888888-8888-8888-8888-888888888215","role":"authenticated"}', false) is not null as uploader_in;
select (select count(*) from public.vendors) = 0 and (select count(*) from public.orders) = 0 as sees_no_vendors_or_orders;
select (select count(*) from public.profiles) = 1 and (select count(*) from public.organizations) = 1 as sees_own_profile_and_org;
select public.invoice_upload_submit('00000000-0000-0000-0000-000000000001/uploads/88888888-8888-8888-8888-888888888215/a.pdf', 'Scan 1', 1000, 'hash215', 3) ? 'id' as submitted;
select public.invoice_upload_submit('00000000-0000-0000-0000-000000000001/uploads/88888888-8888-8888-8888-888888888215/b.pdf', 'Scan 1 again', 1000, 'hash215', 3) ->> 'duplicate' like 'Already submitted by Cat on %' as same_file_twice;
select count(*) = 2 as sees_own_uploads from public.invoice_uploads;
do $$ begin
  perform public.invoice_upload_submit('00000000-0000-0000-0000-000000000001/uploads/someone-else/x.pdf', 'x', 1, 'h', 1);
  raise exception 'should not submit outside their folder';
exception when sqlstate '22023' then null; end $$;
reset role;
select set_config('request.jwt.claims', '', false) is not null as service;
select id as u from public.invoice_uploads where file_hash = 'hash215' and status = 'queued' \gset

-- what Claude read: one files itself, one names a store we don't know, one is the same invoice again
insert into public.invoice_upload_docs (organization_id, upload_id, first_page, last_page, storage_path, vendor_name_read, store_read, folder, doc_number, doc_date, doc_total, sure, vendor_id)
values ('00000000-0000-0000-0000-000000000001', :'u', 1, 1, '00000000-0000-0000-0000-000000000001/uploads/88888888-8888-8888-8888-888888888215/a-1.pdf', 'Milk 215', 'Town Store', 'invoices', '0012345', current_date, 41.50, true, :'v') returning id as d1 \gset
insert into public.invoice_upload_docs (organization_id, upload_id, first_page, last_page, storage_path, vendor_name_read, store_read, folder, doc_number, doc_date, doc_total, sure, vendor_id)
values ('00000000-0000-0000-0000-000000000001', :'u', 2, 2, '00000000-0000-0000-0000-000000000001/uploads/88888888-8888-8888-8888-888888888215/a-2.pdf', 'Bait 215', 'Lodge', 'invoices', 'B77', current_date, 12, true, :'b') returning id as d2 \gset
insert into public.invoice_upload_docs (organization_id, upload_id, first_page, last_page, storage_path, vendor_name_read, store_read, folder, doc_number, doc_date, doc_total, sure, vendor_id)
values ('00000000-0000-0000-0000-000000000001', :'u', 3, 3, '00000000-0000-0000-0000-000000000001/uploads/88888888-8888-8888-8888-888888888215/a-3.pdf', 'Milk 215', 'Marina', 'invoices', '12345', current_date, 41.50, true, :'v') returning id as d3 \gset
select public.invoice_upload_place(:'d1') = 'filed' as first_filed;
select l.store_code = 'SLS' and l.kind = 'invoice' and l.source = 'upload' and l.doc_year = extract(year from current_date) and l.upload_id = :'u'
       and l.created_by = '88888888-8888-8888-8888-888888888215' as filed_to_vendor
  from public.vendor_links l join public.invoice_upload_docs d on d.vendor_link_id = l.id where d.id = :'d1';
select public.invoice_upload_place(:'d3') = 'duplicate' as same_number_is_duplicate;
select duplicate_note like 'Already submitted by Cat on %' as duplicate_says_who from public.invoice_upload_docs where id = :'d3';
select public.invoice_upload_place(:'d2') = 'needs_look' as unknown_store_needs_look;
select d.reason like '%"Lodge"; which store is that?%' and r.kind = 'invoice_upload' and r.status = 'pending' as review_card
  from public.invoice_upload_docs d join public.review_items r on r.id = d.review_item_id where d.id = :'d2';

-- a person picks the store: filed, the name saved as the vendor's alias, the Bill.com send queued
set role authenticated;
select set_config('request.jwt.claims', '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}', false) is not null as admin_in;
select public.invoice_upload_resolve(:'d2', :'b', 'SLH', 'invoices') = 'filed' as resolved;
select invoice_store_aliases ->> 'Lodge' = 'SLH' as alias_saved from public.vendors where id = :'b';
select count(*) = 3 as editor_sees_all_docs from public.invoice_upload_docs where upload_id = :'u';
reset role;
select set_config('request.jwt.claims', '', false) is not null as service;
select (select r.status from public.review_items r join public.invoice_upload_docs d on d.review_item_id = r.id where d.id = :'d2') = 'accepted' as card_closed;
select exists (select 1 from public.billcom_forwards f join public.invoice_upload_docs d on d.vendor_link_id = f.vendor_link_id where d.id = :'d2' and f.email_id is null) as billcom_queued;
select not exists (select 1 from public.billcom_forwards f join public.invoice_upload_docs d on d.vendor_link_id = f.vendor_link_id where d.id = :'d1') as switch_off_not_sent;
select (public.invoice_upload_claim()).id = :'u' as claimed;
select status = 'reading' and attempts = 1 as reading from public.invoice_uploads where id = :'u';

delete from public.billcom_forwards where vendor_id in (:'v', :'b');
delete from public.order_checks where vendor_id in (:'v', :'b');
update public.invoice_upload_docs set review_item_id = null, vendor_link_id = null where upload_id = :'u';
delete from public.review_items where kind = 'invoice_upload' and entity_id in (:'d1', :'d2', :'d3');
delete from public.vendor_links where vendor_id in (:'v', :'b');
delete from public.invoice_uploads where uploaded_by = '88888888-8888-8888-8888-888888888215';
delete from public.vendors where id in (:'v', :'b');
delete from public.profiles where id = '88888888-8888-8888-8888-888888888215';
