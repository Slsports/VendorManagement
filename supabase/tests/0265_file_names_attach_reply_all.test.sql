\set ON_ERROR_STOP on
\pset footer off
\echo '>>> 0265: paperwork names, renamed files kept, reply all on VMS drafts'
reset role;
select set_config('request.jwt.claims', '', false) is not null as service;
insert into public.vendors (organization_id, name) values ('00000000-0000-0000-0000-000000000001', 'FN265 SPORTS') returning id as v \gset

-- a confirmation lands: what it is, the vendor's name, the date
insert into public.vendor_links (organization_id, vendor_id, kind, label, file_name, storage_path, received_at)
values ('00000000-0000-0000-0000-000000000001', :'v', 'confirmation', 'SO-88198', 'SO-88198.pdf', 'x/fn265-1.pdf', '2026-02-28') returning id as l1 \gset
select label = 'Confirmation – SO-88198 – Feb 28, 2026' and orig_label = 'SO-88198' and name_auto as named from public.vendor_links where id = :'l1';
-- the number read later goes in; a vendor name that only repeats it is left out
update public.vendor_links set doc_number = 'SO-88198' where id = :'l1';
select label = 'Confirmation SO-88198 – Feb 28, 2026' as number_added from public.vendor_links where id = :'l1';
-- renamed by hand: kept, even when the number changes
update public.vendor_links set label = 'Maria boots sheet' where id = :'l1';
update public.vendor_links set doc_number = '88198' where id = :'l1';
select label = 'Maria boots sheet' and not name_auto as hand_name_kept from public.vendor_links where id = :'l1';
-- a picture is not renamed
insert into public.vendor_links (organization_id, vendor_id, kind, label, file_name, storage_path, received_at)
values ('00000000-0000-0000-0000-000000000001', :'v', 'image', 'Boot photo – IMG_1.jpg', 'IMG_1.jpg', 'x/fn265-2.jpg', '2026-02-28') returning id as l2 \gset
select label = 'Boot photo – IMG_1.jpg' as picture_untouched from public.vendor_links where id = :'l2';
-- moved from Invoices to Other: back to its own name
insert into public.vendor_links (organization_id, vendor_id, kind, label, file_name, storage_path, received_at)
values ('00000000-0000-0000-0000-000000000001', :'v', 'invoice', 'Invoice_123456789', 'Invoice_123456789.pdf', 'x/fn265-3.pdf', '2026-03-01') returning id as l3 \gset
select label = 'Invoice – 123456789 – Mar 1, 2026' as invoice_named from public.vendor_links where id = :'l3';
update public.vendor_links set kind = 'other' where id = :'l3';
select label = 'Invoice_123456789' and not name_auto as back_to_own_name from public.vendor_links where id = :'l3';

-- reply all: a VMS draft to the sender gets the others on the email (not us)
insert into public.email_threads (organization_id, gmail_thread_id, subject, last_message_at) values ('00000000-0000-0000-0000-000000000001', 'fn265', 'Quote', now()) returning id as t \gset
insert into public.emails (organization_id, thread_id, gmail_id, direction, from_email, to_emails, cc_emails, subject, received_at, vendor_id)
values ('00000000-0000-0000-0000-000000000001', :'t', 'fn265-1', 'in', 'kristen@fn265.example', array['orders@shaverlakesports.com'], array['rep@fn265reps.example', 'noreply@fn265.example'], 'Quote', now(), :'v') returning id as e \gset
insert into public.email_drafts (organization_id, owner_id, created_by, to_emails, subject, body, thread_id, vendor_id, note)
values ('00000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', null, array['kristen@fn265.example'], 'Re: Quote', 'Hi', :'t', :'v', 'VMS') returning id as d1 \gset
select cc_emails = array['rep@fn265reps.example'] as reply_all from public.email_drafts where id = :'d1';
-- a person's own Reply in the app is left as they chose
select set_config('request.jwt.claims', '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}', false) is not null as signed_in;
set role authenticated;
insert into public.email_drafts (organization_id, owner_id, created_by, to_emails, subject, body, thread_id, vendor_id)
values ('00000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', '11111111-1111-1111-1111-111111111111', array['kristen@fn265.example'], 'Re: Quote', 'Hi', :'t', :'v') returning id as d2 \gset
reset role;
select set_config('request.jwt.claims', '', false) is not null as service;
select cc_emails = '{}' as own_reply_kept from public.email_drafts where id = :'d2';
-- a VMS note to one of us in that conversation adds nobody
insert into public.email_drafts (organization_id, owner_id, created_by, to_emails, subject, body, thread_id, vendor_id, note)
values ('00000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', null, array['trevor@shaverlakesports.com'], 'Quote', 'Hi', :'t', :'v', 'VMS') returning id as d3 \gset
select cc_emails = '{}' as note_to_us_alone from public.email_drafts where id = :'d3';

delete from public.email_drafts where thread_id = :'t';
delete from public.emails where thread_id = :'t';
delete from public.email_threads where id = :'t';
delete from public.vendor_links where vendor_id = :'v';
delete from public.vendors where id = :'v';
