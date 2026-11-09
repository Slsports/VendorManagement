\set ON_ERROR_STOP on
\pset footer off
\echo '>>> Freight terms from email go on the order; a freight difference waits for the vendor''s answer'
reset role;
select set_config('request.jwt.claims', '', false) is not null as claims_cleared;
select id as admin_id from public.profiles where organization_id = '00000000-0000-0000-0000-000000000001' and role = 'admin' and is_active order by created_at limit 1 \gset
insert into public.vendors (organization_id, name, email) values ('00000000-0000-0000-0000-000000000001', 'Freight Test Vendor', 'ar@freight-test.example') returning id as v \gset
insert into public.orders (organization_id, vendor_id, status, po_number, order_date, est_cost) values ('00000000-0000-0000-0000-000000000001', :'v', 'confirmed', 'FTV-1', current_date - 30, 1200) returning id as o \gset
insert into public.email_threads (organization_id, gmail_thread_id, subject, vendor_id) values ('00000000-0000-0000-0000-000000000001', 'ft-t1', 'Your order FTV-1', :'v') returning id as t1 \gset
insert into public.emails (organization_id, gmail_id, thread_id, direction, from_email, to_emails, subject, body_text, received_at, vendor_id)
  values ('00000000-0000-0000-0000-000000000001', 'ft-e1', :'t1', 'in', 'rep@freight-test.example', array['orders@example.com'], 'Re: PO FTV-1', 'Yes, free freight on PO FTV-1.', now() - interval '20 days', :'v') returning id as e1 \gset

-- the reader found free freight for PO FTV-1; once applied (since 0325: by a person's answer on the card) it goes on the order with the email as its source
select public.freight_promises_save(:'e1', '[{"terms":"free","po":"FTV-1","basis":"negotiated","said_by":"vendor","quote":"Yes, free freight on PO FTV-1."}]') = 1 as saved;
select public.freight_promise_apply(id) = 'applied' as applied from public.freight_promises where email_id = :'e1';
select free_shipping and freight_terms = 'free' and freight_terms_source = 'email' and freight_terms_source_email_id = :'e1' and free_shipping_note like 'Per Freight Test Vendor''s email%' as order_has_email_terms from public.orders where id = :'o';
select freight_read_at is not null as email_marked_read from public.emails where id = :'e1';

-- the invoice charges freight: a difference, a draft to the vendor and a task
insert into public.vendor_links (organization_id, vendor_id, kind, label, file_name, storage_path, order_id) values ('00000000-0000-0000-0000-000000000001', :'v', 'invoice', 'Invoice 555', 'inv555.pdf', 'test/inv555.pdf', :'o') returning id as doc \gset
-- (filing an invoice makes its paperwork check; the reader then fills in what it read)
update public.order_checks set order_id = :'o', status = 'to_review', doc_number = '555', reading = '{"freight":"45.50","subtotal":"1200","doc_date":"2026-10-01","lines":[]}' where document_id = :'doc' returning id as chk \gset
select kind = 'free_order' and charged = 45.50 and status = 'open' and draft_id is not null and task_id is not null and expected_text like '%confirmed free freight by email%' as issue_made
  from public.freight_issues where check_id = :'chk';
select id as issue, draft_id as draft, task_id as task from public.freight_issues where check_id = :'chk' \gset
select 'ar@freight-test.example' = any (to_emails) and body like '%charges $45.50 freight%' and :'doc' = any (vendor_link_ids) and order_id is null as draft_to_vendor from public.email_drafts where id = :'draft';
select title like 'Freight on Freight Test Vendor invoice 555: charged $45.50, should be free%' and draft_id = :'draft' as task_ready from public.tasks where id = :'task';

-- sent: the task stays open and waits; no second credit request from that email
insert into public.emails (organization_id, gmail_id, thread_id, direction, from_email, to_emails, subject, received_at, vendor_id)
  values ('00000000-0000-0000-0000-000000000001', 'ft-out', :'t1', 'out', 'orders@example.com', array['ar@freight-test.example'], 'Freight on invoice 555', now() - interval '1 day', :'v') returning id as out1 \gset
select (public.mail_command_sent(:'draft', :'out1', :'admin_id'))::text = '' as sent_ran;
select status = 'emailed' and thread_id = :'t1' as issue_emailed from public.freight_issues where id = :'issue';
select done_at is null and title like 'Waiting for Freight Test Vendor%' and due_date > current_date as task_waits from public.tasks where id = :'task';
select credit_read_at is not null as not_a_second_credit_request from public.emails where id = :'out1';

-- their answer closes it, by VMS, with their email
insert into public.emails (organization_id, gmail_id, thread_id, direction, from_email, to_emails, subject, received_at, vendor_id)
  values ('00000000-0000-0000-0000-000000000001', 'ft-ans', :'t1', 'in', 'ar@freight-test.example', array['orders@example.com'], 'Re: Freight on invoice 555', now(), :'v') returning id as ans \gset
select status = 'answered' and answer_email_id = :'ans' as issue_answered from public.freight_issues where id = :'issue';
select done_at is not null and closed_how = 'vms' and done_email_id = :'ans' and done_note like 'VMS closed it: Freight Test Vendor answered%' as task_closed_by_answer from public.tasks where id = :'task';

-- a second invoice, terms changed before anything was sent: dropped, draft gone, task closed
insert into public.vendor_links (organization_id, vendor_id, kind, label, file_name, storage_path, order_id) values ('00000000-0000-0000-0000-000000000001', :'v', 'invoice', 'Invoice 556', 'inv556.pdf', 'test/inv556.pdf', :'o') returning id as doc2 \gset
update public.order_checks set order_id = :'o', status = 'to_review', doc_number = '556', reading = '{"freight":"20","subtotal":"300","lines":[]}' where document_id = :'doc2' returning id as chk2 \gset
select draft_id as draft2, task_id as task2 from public.freight_issues where check_id = :'chk2' \gset
update public.orders set free_shipping = false, freight_terms = 'charged', freight_terms_source = 'person' where id = :'o';
select status = 'dropped' as dropped_when_terms_change from public.freight_issues where check_id = :'chk2';
select not exists (select 1 from public.email_drafts where id = :'draft2') as draft_removed;
select done_at is not null and closed_how = 'vms' as task2_closed from public.tasks where id = :'task2';

-- a person set the order: a differing email does not overwrite it; that person gets a task
insert into public.email_threads (organization_id, gmail_thread_id, subject, vendor_id) values ('00000000-0000-0000-0000-000000000001', 'ft-t3', 'PO FTV-1 again', :'v') returning id as t3 \gset
insert into public.emails (organization_id, gmail_id, thread_id, direction, from_email, to_emails, subject, body_text, received_at, vendor_id)
  values ('00000000-0000-0000-0000-000000000001', 'ft-e2', :'t3', 'in', 'rep@freight-test.example', array['orders@example.com'], 'Re: PO FTV-1', 'Free freight on FTV-1 after all.', now(), :'v') returning id as e2 \gset
select public.freight_promises_save(:'e2', '[{"terms":"free","po":"FTV-1","said_by":"vendor","quote":"Free freight on FTV-1 after all."}]') = 1 as saved_2;
select public.freight_promise_apply(id) = 'person_set' as person_set from public.freight_promises where email_id = :'e2';
select freight_terms = 'charged' as person_terms_stand from public.orders where id = :'o';
select exists (select 1 from public.tasks t join public.freight_promises p on t.auto_key = 'freightterms:' || p.id where p.email_id = :'e2' and t.done_at is null) as person_gets_task;

-- no PO and no order in the conversation: "Which order?", picked by a person
insert into public.email_threads (organization_id, gmail_thread_id, subject, vendor_id) values ('00000000-0000-0000-0000-000000000001', 'ft-t2', 'Show special', :'v') returning id as t2 \gset
insert into public.emails (organization_id, gmail_id, thread_id, direction, from_email, to_emails, subject, received_at, vendor_id)
  values ('00000000-0000-0000-0000-000000000001', 'ft-e3', :'t2', 'in', 'rep@freight-test.example', array['orders@example.com'], 'Show special', now(), :'v') returning id as e3 \gset
select public.freight_promises_save(:'e3', '[{"terms":"free_over","free_over":"1000","said_by":"vendor","quote":"Free freight over $1,000 on your show order."}]') = 1 as saved_3;
select id as p3 from public.freight_promises where email_id = :'e3' \gset
select status = 'review' as waits_for_a_person from public.freight_promises where id = :'p3';
insert into public.orders (organization_id, vendor_id, status, po_number, order_date, est_cost) values ('00000000-0000-0000-0000-000000000001', :'v', 'open', 'FTV-2', current_date, 1500) returning id as o2 \gset
set role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', :'admin_id', 'role', 'authenticated')::text, false) is not null as as_admin;
select public.freight_promise_set_order(:'p3', :'o2') = 'applied' as picked;
reset role;
select set_config('request.jwt.claims', '', false) is not null as claims_cleared_2;
select free_over = 1000 and free_shipping and freight_terms_source = 'person' and freight_terms_source_email_id = :'e3' as picked_order_has_terms from public.orders where id = :'o2';

-- the queue reads only shared vendor mail about freight
select count(*) = 0 as read_mail_not_queued from public.mail_freight_queue('00000000-0000-0000-0000-000000000001', 50) q where q.email_id in (:'e1', :'e2', :'e3');

-- clean up
delete from public.tasks where vendor_id = :'v';
delete from public.order_checks where vendor_id = :'v';
delete from public.review_items where entity_id in (select id from public.freight_promises where vendor_id = :'v');
delete from public.freight_promises where vendor_id = :'v';
delete from public.email_drafts where vendor_id = :'v';
delete from public.email_threads where id in (:'t1', :'t2', :'t3');
delete from public.vendor_links where vendor_id = :'v';
delete from public.orders where vendor_id = :'v';
delete from public.vendors where id = :'v';
