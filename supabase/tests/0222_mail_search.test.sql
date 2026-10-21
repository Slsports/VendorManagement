\set ON_ERROR_STOP on
\pset footer off
\echo '>>> Mail search: names, addresses, vendor, contact, attachment, PO, text, filters'
reset role;
select set_config('request.jwt.claims', '', false) is not null as service;
insert into public.vendors (organization_id, name, aliases) values ('00000000-0000-0000-0000-000000000001', 'LAZY ONE 222', array['Richmond Apparel 222']) returning id as v \gset
insert into public.vendor_emails (organization_id, vendor_id, email, contact_name) values ('00000000-0000-0000-0000-000000000001', :'v', 'sharonb222@lazyone.test', 'Sharon Brownstone') returning id as c \gset
insert into public.orders (organization_id, vendor_id, status, po_number) values ('00000000-0000-0000-0000-000000000001', :'v', 'open', 'LAZY222SHOW') returning id as o \gset
insert into public.email_threads (organization_id, gmail_thread_id, subject, last_message_at) values ('00000000-0000-0000-0000-000000000001', 's222-a', 'Re-order show', now()) returning id as ta \gset
insert into public.email_threads (organization_id, gmail_thread_id, subject, last_message_at) values ('00000000-0000-0000-0000-000000000001', 's222-b', 'Freight quote', now()) returning id as tb \gset
insert into public.emails (organization_id, thread_id, gmail_id, direction, from_email, from_name, to_emails, subject, body_text, received_at, vendor_id, order_id, has_attachments)
  values ('00000000-0000-0000-0000-000000000001', :'ta', 's222-1', 'in', 'sharonb222@lazyone.test', 'Sharon', array['orders@shaverlakesports.com'], 'Re-order show', 'Should I ship this order that I have? Bellies and Boos.', now() - interval '2 days', :'v', :'o', true)
  returning id as ea \gset
insert into public.emails (organization_id, thread_id, gmail_id, direction, from_email, from_name, to_emails, subject, body_text, received_at, has_attachments)
  values ('00000000-0000-0000-0000-000000000001', :'tb', 's222-2', 'in', 'quotes222@freight.test', 'Quote Desk', array['orders@shaverlakesports.com'], 'Freight quote', 'Pallet rate attached.', now() - interval '40 days', false)
  returning id as eb \gset
insert into public.email_attachments (organization_id, email_id, file_name, mime_type) values ('00000000-0000-0000-0000-000000000001', :'ea', 'LazyOne_Show_Order_92826.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
select search is not null as indexed from public.emails where id = :'ea';

select set_config('request.jwt.claims', '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}', false) is not null as dana;
set role authenticated;
select count(*) = 1 and bool_and(why = 'sender') as by_sender_address from public.mail_search('sharonb222', '{}');
select count(*) = 1 and bool_and(why = 'contact name') as by_contact_name from public.mail_search('brownstone', '{}');
select count(*) = 1 and bool_and(why = 'vendor') as by_vendor_other_name from public.mail_search('richmond apparel 222', '{}');
select count(*) = 1 and bool_and(why = 'attachment') as by_file_name from public.mail_search('92826', '{}');
select count(*) = 1 and bool_and(why = 'PO') as by_po from public.mail_search('LAZY222SHOW', '{}');
select count(*) = 1 and bool_and(why = 'text' and headline like '%<<Bellies>>%') as by_text_with_words from public.mail_search('bellies', '{}');
select count(*) = 1 and bool_and(email_id = :'ea') as opens_the_email from public.mail_search('bellies', '{}');
select count(*) = 0 as every_word_needed from public.mail_search('bellies pallet', '{}');
select count(*) >= 1 and bool_and(thread_id <> :'ta') as no_attachment_filter from public.mail_search('', '{"attach": false}') where thread_id in (:'ta', :'tb');
select count(*) = 1 as spreadsheet_filter from public.mail_search('', '{"file": "sheet"}') where thread_id in (:'ta', :'tb');
select count(*) = 1 as last_30_days from public.mail_search('', jsonb_build_object('since', (current_date - 30)::text)) where thread_id in (:'ta', :'tb');
select count(*) = 1 as with_person from public.mail_search('', '{"with": "SharonB222@lazyone.test"}');
select count(*) = 1 as vendor_filter from public.mail_search('', jsonb_build_object('vendor_id', :'v'));
select count(*) >= 3 as suggests_people_vendor_po from (select kind from public.mail_suggest('222') where kind in ('person', 'vendor', 'order') group by kind) k;
select count(*) = 0 as suggest_needs_two_letters from public.mail_suggest('s');

reset role;
select set_config('request.jwt.claims', '', false) is not null as service_again;
delete from public.email_attachments where email_id = :'ea';
delete from public.emails where id in (:'ea', :'eb');
delete from public.email_threads where id in (:'ta', :'tb');
delete from public.orders where id = :'o';
delete from public.vendor_emails where id = :'c';
delete from public.vendors where id = :'v';
