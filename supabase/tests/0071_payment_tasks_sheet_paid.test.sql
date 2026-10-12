\set ON_ERROR_STOP on
\pset footer off
reset role;
\echo '>>> Pay-by tasks: a payment sheet counts as paid'
insert into public.vendors (organization_id, name) values ('00000000-0000-0000-0000-000000000001', 'Pay Sheet Vendor') returning id as v2 \gset
insert into public.wwd_invoices (organization_id, seq, kind, vendor_id, vendor_invoice_date, amount, terms)
values ('00000000-0000-0000-0000-000000000001', 'PT-2', 'invoice', :'v2', current_date - 5, 500, '2% 30, NET 60') returning id as w2 \gset
select public.sync_payment_tasks('00000000-0000-0000-0000-000000000001') as made_one;
update public.wwd_invoices set sheet_paid_date = current_date where id = :'w2';
select public.sync_payment_tasks('00000000-0000-0000-0000-000000000001') is not null as synced;
select done_note from public.tasks where auto_key = 'wwd:' || :'w2' || ':30';
delete from public.tasks where vendor_id = :'v2';
delete from public.wwd_invoices where id = :'w2';
delete from public.vendors where id = :'v2';
