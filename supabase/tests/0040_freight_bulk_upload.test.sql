\set ON_ERROR_STOP on
\pset footer off
\echo '>>> an uploaded bill finds its billing company by our UPS number, fills the waiting bill, a second copy is skipped'
reset role;
select id as ps from public.carriers where organization_id = '00000000-0000-0000-0000-000000000001' and name = 'PartnerShip' \gset
insert into public.freight_bills (organization_id, carrier_id, invoice_number, total, status) values ('00000000-0000-0000-0000-000000000001', :'ps', 'PS00625902', 416.28, 'needs_pdf') returning id as waiting \gset
insert into public.freight_bills (organization_id, storage_path, file_name, invoice_number, total, status) values ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001/freight/a.pdf', 'a.pdf', 'PS00625902', 416.28, 'to_match') returning id as up1 \gset
insert into public.freight_bill_lines (organization_id, bill_id, shipper_name, amount, sort_order) values ('00000000-0000-0000-0000-000000000001', :'up1', 'Stansport', 416.28, 0);
select split_part(public.freight_bill_settle(:'up1', 'V513K4', 'PartnerShip LLC'), ':', 1) as first_upload;
select storage_path is not null as has_pdf, status, (select count(*) from public.freight_bill_lines where bill_id = :'waiting') as lines from public.freight_bills where id = :'waiting';
insert into public.freight_bills (organization_id, storage_path, file_name, invoice_number, status) values ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001/freight/b.pdf', 'b.pdf', 'PS00625902', 'to_match') returning id as up2 \gset
select split_part(public.freight_bill_settle(:'up2', null, 'PartnerShip'), ':', 1) as second_upload;
\echo '>>> UPS DIRECT by its number; an unknown company asks'
insert into public.freight_bills (organization_id, storage_path, file_name, invoice_number, status) values ('00000000-0000-0000-0000-000000000001', 'x/c.pdf', 'c.pdf', '000089787W406', 'to_match') returning id as up3 \gset
select public.freight_bill_settle(:'up3', '89787-W', 'UPS') as ups_direct;
select c.name as carrier from public.freight_bills b join public.carriers c on c.id = b.carrier_id where b.id = :'up3';
insert into public.freight_bills (organization_id, storage_path, file_name, status) values ('00000000-0000-0000-0000-000000000001', 'x/d.pdf', 'd.pdf', 'to_match') returning id as up4 \gset
select public.freight_bill_settle(:'up4', null, 'Acme Trucking') as unknown;
\echo '>>> PartnerShip by our account number with them (792862), even with a generic company name'
update public.carriers set account_number = '792862' where organization_id = '00000000-0000-0000-0000-000000000001' and name = 'PartnerShip';
insert into public.freight_bills (organization_id, storage_path, file_name, invoice_number, status) values ('00000000-0000-0000-0000-000000000001', 'x/e.pdf', 'e.pdf', 'PS00700001', 'to_match') returning id as up5 \gset
select public.freight_bill_settle(:'up5', null, 'Parcel billing', '#792862') as by_account;
select c.name as carrier from public.freight_bills b join public.carriers c on c.id = b.carrier_id where b.id = :'up5';
