\set ON_ERROR_STOP on
\pset footer off
\echo '>>> our reply "paid by ACH 10/8/26 by Dana" marks the bill of that conversation paid'
reset role;
insert into public.carriers (organization_id, name, mode, email_domains) values ('00000000-0000-0000-0000-000000000001', 'Pay Express', 'parcel', '{payex.example}') returning id as pc \gset
insert into public.email_threads (organization_id, gmail_thread_id, carrier_id) values ('00000000-0000-0000-0000-000000000001', 'pay1', :'pc') returning id as pt \gset
insert into public.emails (organization_id, gmail_id, thread_id, direction, from_email, subject, received_at) values ('00000000-0000-0000-0000-000000000001', 'paym1', :'pt', 'in', 'do-not-reply@payex.example', 'Invoice #261005W105025', now() - interval '1 day') returning id as pe1 \gset
insert into public.emails (organization_id, gmail_id, thread_id, direction, from_email, subject, received_at) values ('00000000-0000-0000-0000-000000000001', 'paym2', :'pt', 'out', 'orders@shaverlakesports.com', 'Re: Invoice', now()) returning id as pe2 \gset
insert into public.freight_bills (organization_id, carrier_id, email_id, invoice_number, total, status) values ('00000000-0000-0000-0000-000000000001', :'pc', :'pe1', '261005W105025', 235.48, 'to_match') returning id as pb \gset
select public.freight_apply_payment('00000000-0000-0000-0000-000000000001', null, :'pe2', 'email', null, '2026-10-08', 'ach', null, '{}', 'Dana', null, null) as result;
select paid_date, paid_via, paid_source, paid_by is not null as who_known from public.freight_bills where id = :'pb';
\echo '>>> a receipt naming nothing we can match goes to the review queue; the card marks the bill paid'
insert into public.email_threads (organization_id, gmail_thread_id, carrier_id) values ('00000000-0000-0000-0000-000000000001', 'pay2', :'pc') returning id as pt2 \gset
insert into public.emails (organization_id, gmail_id, thread_id, direction, from_email, subject, received_at) values ('00000000-0000-0000-0000-000000000001', 'paym3', :'pt2', 'in', 'noreply@payex.example', 'Payment Receipt', now()) returning id as pe3 \gset
insert into public.freight_bills (organization_id, carrier_id, invoice_number, total, status) values ('00000000-0000-0000-0000-000000000001', :'pc', '18493871', 412.10, 'to_match') returning id as pb2 \gset
select public.freight_apply_payment('00000000-0000-0000-0000-000000000001', :'pc', :'pe3', 'receipt', 999.00, '2026-10-08', 'ach', 'R1', '{}', null, 'org/freight/r.pdf', 'r.pdf') as result;
select id as ri from public.review_items where kind = 'freight_payment' and entity_id = :'pe3' \gset
set role authenticated;
select set_config('request.jwt.claims', '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}', false);
select public.answer_freight_payment(:'ri', :'pb2');
reset role;
select paid_date is not null as paid, receipt_file_name, paid_ref from public.freight_bills where id = :'pb2';
\echo '>>> a receipt by invoice number marks that bill paid with the receipt'
update public.freight_bills set paid_date = null, paid_email_id = null, receipt_file_name = null, paid_ref = null where id = :'pb2';
select public.freight_apply_payment('00000000-0000-0000-0000-000000000001', :'pc', :'pe3', 'receipt', 412.10, '2026-10-08', 'ach', 'R2', '{18493871}', null, 'org/freight/r2.pdf', 'r2.pdf') as result;
select paid_ref, receipt_file_name from public.freight_bills where id = :'pb2';
