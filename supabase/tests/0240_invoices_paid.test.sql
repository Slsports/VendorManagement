\set ON_ERROR_STOP on
\pset footer off
\echo '>>> Paid invoices from payment emails; paperwork-only vendors get no order check'
reset role;
select set_config('request.jwt.claims', '', false) is not null as service;
insert into public.vendors (organization_id, name, no_order_checks) values ('00000000-0000-0000-0000-000000000001', 'PAY240 ROSSI', true) returning id as v \gset
insert into public.email_threads (organization_id, gmail_thread_id, subject, last_message_at) values ('00000000-0000-0000-0000-000000000001', 'pay240', 'Payment initiated', now()) returning id as t \gset
insert into public.emails (organization_id, thread_id, gmail_id, direction, from_email, subject, body_text, received_at, vendor_id)
values ('00000000-0000-0000-0000-000000000001', :'t', 'pay240-1', 'in', 'ty@example.com', 'Fwd: Your Enrolled Payment to Rossi Group has been initiated',
        'The attached invoices have been paid through the Rossi bill pay. Also 5058-0003', now() - interval '1 hour', :'v') returning id as e \gset

-- its invoice: filed, no order check
insert into public.vendor_links (organization_id, vendor_id, kind, label, storage_path, email_id, doc_number) values
  ('00000000-0000-0000-0000-000000000001', :'v', 'invoice', 'Invoice 50580001', 'x/pay240a.pdf', :'e', '50580001') returning id as i1 \gset
insert into public.email_attachments (organization_id, email_id, file_name, vendor_link_id) values ('00000000-0000-0000-0000-000000000001', :'e', 'Invoice_50580001.pdf', :'i1');
insert into public.vendor_links (organization_id, vendor_id, kind, label, storage_path, doc_number) values
  ('00000000-0000-0000-0000-000000000001', :'v', 'invoice', 'Invoice 50580002', 'x/pay240b.pdf', '50580002') returning id as i2 \gset
select count(*) = 0 as no_order_check from public.order_checks where document_id in (:'i1', :'i2');

-- the email is found once; Claude says: paid Oct 22 through their bill pay, the attached ones and 5058-0003
select public.payment_notices_find('00000000-0000-0000-0000-000000000001') = 1 and public.payment_notices_find('00000000-0000-0000-0000-000000000001') = 0 as found_once;
select public.payment_notice_read(:'e', true, '2026-10-22', 'Rossi bill pay', array['5058-0003'], true, 'Tyler paid the attached invoices') = 1 as marked_attached;
select paid_at = '2026-10-22' and paid_how = 'Rossi bill pay' and paid_email_id = :'e' and paid_thread_id = :'t' as attached_paid from public.vendor_links where id = :'i1';
select paid_at is null as other_not_paid from public.vendor_links where id = :'i2';
select unmatched = array['5058-0003'] as kept_for_later from public.payment_notices where email_id = :'e';
-- the named invoice filed later is marked paid when it lands
insert into public.vendor_links (organization_id, vendor_id, kind, label, storage_path, doc_number) values
  ('00000000-0000-0000-0000-000000000001', :'v', 'invoice', 'Invoice 50580003', 'x/pay240c.pdf', '50580003') returning id as i3 \gset
select paid_at = '2026-10-22' as later_paid from public.vendor_links where id = :'i3';
select unmatched = '{}' and marked = 2 as notice_updated from public.payment_notices where email_id = :'e';
-- not a payment: nothing marked
update public.vendor_links set paid_at = null, paid_how = null, paid_email_id = null where id = :'i2';
insert into public.emails (organization_id, thread_id, gmail_id, direction, from_email, subject, body_text, received_at, vendor_id)
values ('00000000-0000-0000-0000-000000000001', :'t', 'pay240-2', 'in', 'ar@example.com', 'Payment Due: 50580002', 'Your payment is due', now(), :'v') returning id as e2 \gset
select public.payment_notices_find('00000000-0000-0000-0000-000000000001') = 1 as due_notice_queued;
select public.payment_notice_read(:'e2', false, null, '', array['50580002'], false, 'A payment reminder, not a payment') = 0 as reminder_marks_nothing;
select paid_at is null as still_unpaid from public.vendor_links where id = :'i2';

delete from public.activity_log where entity_id = :'v';
delete from public.payment_notices where vendor_id = :'v';
delete from public.email_attachments where email_id in (:'e', :'e2');
delete from public.vendor_links where vendor_id = :'v';
delete from public.emails where thread_id = :'t';
delete from public.email_threads where id = :'t';
delete from public.vendors where id = :'v';
