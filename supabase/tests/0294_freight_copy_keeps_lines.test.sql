\set ON_ERROR_STOP on
\pset footer off
\echo '>>> 0294: a waiting bill that already has its lines keeps them; it only takes the PDF'
reset role;
select set_config('request.jwt.claims', '', false) is not null as service;
insert into public.carriers (organization_id, name, role) values ('00000000-0000-0000-0000-000000000001', 'Carrier 0294', 'billing') returning id as c \gset
insert into public.freight_bills (organization_id, carrier_id, invoice_number, status, total) values ('00000000-0000-0000-0000-000000000001', :'c', 'K0294', 'done', 100) returning id as kept \gset
insert into public.freight_bill_lines (organization_id, bill_id, shipper_name, amount, confirmed) values ('00000000-0000-0000-0000-000000000001', :'kept', 'VENDOR A', 60, true), ('00000000-0000-0000-0000-000000000001', :'kept', 'VENDOR B', 40, true);
insert into public.freight_bills (organization_id, carrier_id, invoice_number, storage_path, file_name, status, total) values ('00000000-0000-0000-0000-000000000001', :'c', 'K-0294', 'test/0294.pdf', '0294.pdf', 'to_match', 100) returning id as up \gset
insert into public.freight_bill_lines (organization_id, bill_id, shipper_name, amount) values ('00000000-0000-0000-0000-000000000001', :'up', 'WORLD WIDE DISTRIBUTORS INC', 100);
select public.freight_bill_settle(:'up', null, null) = 'filled:' || :'kept' as filled;
select (select storage_path from public.freight_bills where id = :'kept') = 'test/0294.pdf' as took_pdf,
       (select status from public.freight_bills where id = :'kept') = 'done' as kept_status,
       (select count(*) from public.freight_bill_lines where bill_id = :'kept') = 2 as kept_its_two_lines,
       not exists (select 1 from public.freight_bills where id = :'up') as copy_gone;
delete from public.freight_bills where carrier_id = :'c';
delete from public.carriers where id = :'c';
