\set ON_ERROR_STOP on
\pset footer off
\echo '>>> 0273: a Worldwide invoice ties to the order whose paper has the same invoice number, dash or no dash'
reset role;
select set_config('request.jwt.claims', '', false) is not null as service;
insert into public.vendors (organization_id, name) values ('00000000-0000-0000-0000-000000000001', 'DASH273') returning id as v \gset
insert into public.orders (organization_id, vendor_id, po_number, status) values ('00000000-0000-0000-0000-000000000001', :'v', 'DASH2426', 'entered') returning id as o \gset
insert into public.vendor_links (organization_id, vendor_id, kind, label, storage_path, file_name, received_at, doc_number, order_id)
values ('00000000-0000-0000-0000-000000000001', :'v', 'invoice', 'I77198-2', 'x/dash273.pdf', 'I77198-2.pdf', current_date, 'I77198-2', :'o');
insert into public.wwd_invoices (organization_id, seq, kind, vendor_id, amount, vendor_invoice_number)
values ('00000000-0000-0000-0000-000000000001', 'dash273', 'invoice', :'v', 479.40, 'I771982') returning id as w \gset
select public.wwd_relink('00000000-0000-0000-0000-000000000001') is not null as ran;
select order_id = :'o' as tied_by_invoice_number from public.wwd_invoices where id = :'w';
delete from public.wwd_invoices where id = :'w';
delete from public.vendor_links where vendor_id = :'v';
delete from public.orders where id = :'o';
delete from public.vendors where id = :'v';
