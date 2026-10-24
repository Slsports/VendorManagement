\set ON_ERROR_STOP on
\pset footer off
\echo '>>> Planet Cotton: the rep sheet is our order, proof tasks remind now, approval by reply says so, freight quote asked once'
reset role;
select set_config('request.jwt.claims', '', false) is not null as service;
insert into public.vendors (organization_id, name, email, order_sheet_senders, ask_freight_quote) values
  ('00000000-0000-0000-0000-000000000001', 'PC236 COTTON', 'kristen@pc236.example.com', array['mary@reps236.example.com'], true) returning id as v \gset
insert into public.orders (organization_id, vendor_id, status, order_date) values ('00000000-0000-0000-0000-000000000001', :'v', 'open', current_date) returning id as o \gset
insert into public.email_threads (organization_id, gmail_thread_id, subject, last_message_at) values ('00000000-0000-0000-0000-000000000001', 'pc236', 'Closeout', now()) returning id as t \gset
insert into public.emails (organization_id, thread_id, gmail_id, direction, from_email, subject, body_text, received_at, order_id)
values ('00000000-0000-0000-0000-000000000001', :'t', 'pc236-1', 'in', 'mary@reps236.example.com', 'Closeout', 'Here is the sheet', now() - interval '3 hours', :'o') returning id as e1 \gset
insert into public.emails (organization_id, thread_id, gmail_id, direction, from_email, subject, body_text, received_at)
values ('00000000-0000-0000-0000-000000000001', :'t', 'pc236-2', 'in', 'mary@reps236.example.com', 'Re: Closeout', 'Updated sheet', now() - interval '2 hours') returning id as e2 \gset

-- her spreadsheet is our order, on the order its conversation is tied to; her picture is not
insert into public.vendor_links (organization_id, vendor_id, kind, label, file_name, storage_path, email_id) values
  ('00000000-0000-0000-0000-000000000001', :'v', 'specials', 'PC closeout', 'PC closeout Oct 2026.xlsx', 'x/pc236a.xlsx', :'e2') returning id as d1, kind as k1, order_id as do1 \gset
insert into public.vendor_links (organization_id, vendor_id, kind, label, file_name, storage_path, email_id) values
  ('00000000-0000-0000-0000-000000000001', :'v', 'confirmation', 'PC flyer', 'flyer.pdf', 'x/pc236b.pdf', :'e2') returning id as d2, kind as k2 \gset
select :'k1' = 'order' and :'do1' = :'o' and :'k2' = 'confirmation' as sheet_is_our_order;
select count(*) = 0 as no_check_on_the_sheet from public.order_checks where document_id = :'d1';

-- a proof: its task reminds right away
insert into public.vendor_links (organization_id, vendor_id, kind, label, file_name, storage_path, email_id, order_id, received_at) values
  ('00000000-0000-0000-0000-000000000001', :'v', 'proof', 'R6886 proof', 'R6886.pdf', 'x/pc236c.pdf', :'e1', :'o', current_date) returning id as p \gset
select remind_at is not null and remind_at <= now() as proof_reminds_now from public.tasks where auto_key = 'proof:' || :'p';
-- while the proof waits, no freight quote request yet
select public.order_freight_ask(:'o') is null as waits_for_the_proof;

-- our reply approves it: the task says so, with the email
insert into public.emails (organization_id, thread_id, gmail_id, direction, from_email, subject, body_text, received_at)
values ('00000000-0000-0000-0000-000000000001', :'t', 'pc236-3', 'out', 'orders@example.com', 'Re: Closeout', E'Those look great\n\nOn Oct 22 Mary wrote:\n> proof attached', now() - interval '1 hour') returning id as e3 \gset
update public.email_threads set art_status = 'waiting', art_since = now() - interval '3 hours' where id = :'t';
select public.mail_apply_art(:'e3', 'approved', 'Dana: Those look great') = 'approved' as approved;
select done_at is not null and done_note like 'Approved by your reply on %: "Those look great"' and done_email_id = :'e3' and closed_how = 'vms'
  as close_note from public.tasks where auto_key = 'proof:' || :'p';
-- approving set art_approved_at: the freight quote request is drafted, with its task
select art_approved_at is not null as art_approved from public.orders where id = :'o';
select t.draft_id is not null and t.remind_at is not null and d.to_emails = array['kristen@pc236.example.com'] and d.body like '%send us your freight quote%'
  as freight_ask from public.tasks t join public.email_drafts d on d.id = t.draft_id where t.auto_key = 'fqask:' || :'o';
select public.order_freight_ask(:'o') is null as only_once;

-- a vendor that doesn't ask: nothing
update public.vendors set ask_freight_quote = false where id = :'v';
insert into public.orders (organization_id, vendor_id, status, order_date) values ('00000000-0000-0000-0000-000000000001', :'v', 'open', current_date - 2) returning id as o2 \gset
select public.order_freight_ask(:'o2') is null as not_for_others;

delete from public.tasks where vendor_id = :'v';
delete from public.email_drafts where vendor_id = :'v';
delete from public.activity_log where entity_id in (:'o', :'o2');
delete from public.order_checks where vendor_id = :'v';
delete from public.vendor_links where vendor_id = :'v';
update public.email_threads set art_email_id = null, art_approved_email_id = null where id = :'t';
delete from public.emails where thread_id = :'t';
delete from public.email_threads where id = :'t';
delete from public.orders where vendor_id = :'v';
delete from public.vendors where id = :'v';
