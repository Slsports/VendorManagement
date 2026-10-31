\set ON_ERROR_STOP on
\pset footer off
\echo '>>> 0270: an order with an approved freight price gets no new quote from later mail'
insert into public.vendors (organization_id, name) values ('00000000-0000-0000-0000-000000000001', 'FQ270 GLOVES') returning id as v2 \gset
insert into public.orders (organization_id, vendor_id, po_number, status) values ('00000000-0000-0000-0000-000000000001', :'v2', 'FQ270', 'confirmed') returning id as o2 \gset
insert into public.email_threads (organization_id, gmail_thread_id, subject, last_message_at) values ('00000000-0000-0000-0000-000000000001', 'fq270', 'PO FQ270', now()) returning id as t2 \gset
insert into public.emails (organization_id, thread_id, gmail_id, direction, from_email, subject, body_text, received_at, vendor_id)
values ('00000000-0000-0000-0000-000000000001', :'t2', 'fq270-1', 'in', 'steve@fq270.example', 'PO FQ270', 'XPO $1629', now() - interval '1 day', :'v2'),
       ('00000000-0000-0000-0000-000000000001', :'t2', 'fq270-2', 'in', 'steve@fq270.example', 'PO FQ270', 'Yes it is ready', now(), :'v2');
select public.freight_quote_apply((select id from public.emails where gmail_id = 'fq270-1'), true, '{"carrier":"XPO","cost":"1629"}'::jsonb, :'v2', :'o2', 'po') as q2 \gset
update public.freight_quotes set status = 'approved', approved_choice = 'other', approved_cost = 1043 where id = :'q2';
select public.freight_quote_apply((select id from public.emails where gmail_id = 'fq270-2'), true, '{}'::jsonb, :'v2', :'o2', 'po') is null as no_new_quote;
select count(*) = 1 as still_one from public.freight_quotes where order_id = :'o2';
delete from public.tasks where vendor_id = :'v2';
delete from public.freight_quotes where vendor_id = :'v2';
delete from public.emails where thread_id = :'t2';
delete from public.email_threads where id = :'t2';
delete from public.orders where id = :'o2';
delete from public.vendors where id = :'v2';
