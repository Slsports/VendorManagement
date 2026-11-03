\set ON_ERROR_STOP on
\pset footer off
\echo '>>> 0288: a corrected freight bill (same number, new total) replaces the one on file'
reset role;
select set_config('request.jwt.claims', '', false) is not null as service;
insert into public.carriers (organization_id, name, role) values ('00000000-0000-0000-0000-000000000001', 'Carrier 0288', 'billing') returning id as c \gset
insert into public.freight_bills (organization_id, carrier_id, invoice_number, total, storage_path, file_name, status, paid_date)
values ('00000000-0000-0000-0000-000000000001', :'c', 'INV-0288', 100, 'test/0288-a.pdf', 'first.pdf', 'to_match', date '2026-10-01') returning id as kept \gset
insert into public.freight_bill_lines (organization_id, bill_id, shipper_name, ship_date, amount, confirmed) values
  ('00000000-0000-0000-0000-000000000001', :'kept', 'SHIP A', date '2026-09-01', 60, true),
  ('00000000-0000-0000-0000-000000000001', :'kept', 'SHIP B', date '2026-09-02', 40, false);
insert into public.freight_bills (organization_id, carrier_id, invoice_number, total, storage_path, file_name, status)
values ('00000000-0000-0000-0000-000000000001', :'c', 'INV 0288', 90, 'test/0288-b.pdf', 'corrected.pdf', 'to_match') returning id as newer \gset
insert into public.freight_bill_lines (organization_id, bill_id, shipper_name, ship_date, amount) values
  ('00000000-0000-0000-0000-000000000001', :'newer', 'SHIP A', date '2026-09-01', 60),
  ('00000000-0000-0000-0000-000000000001', :'newer', 'SHIP B', date '2026-09-02', 30);
select public.freight_bill_settle(:'newer', null, null) = 'corrected:' || :'kept' as corrected;
select b.total = 90 as new_total, b.storage_path = 'test/0288-b.pdf' as new_pdf, b.paid_date = date '2026-10-01' as payment_kept,
       b.read_note like 'Corrected bill (corrected.pdf, $90%' as note,
       (select count(*) from public.freight_bill_lines where bill_id = b.id) = 2 as two_lines,
       (select amount from public.freight_bill_lines where bill_id = b.id and shipper_name = 'SHIP B') = 30 as new_amount,
       (select count(*) from public.freight_bills where carrier_id = :'c') = 1 as one_bill
  from public.freight_bills b where b.id = :'kept';

\echo '>>> an exact copy (same total) is still just dropped'
insert into public.freight_bills (organization_id, carrier_id, invoice_number, total, storage_path, file_name, status)
values ('00000000-0000-0000-0000-000000000001', :'c', 'INV-0288', 90, 'test/0288-c.pdf', 'copy.pdf', 'to_match') returning id as copy \gset
select public.freight_bill_settle(:'copy', null, null) = 'duplicate:' || :'kept' as duplicate,
       (select storage_path from public.freight_bills where id = :'kept') = 'test/0288-b.pdf' as kept_pdf_unchanged;

delete from public.freight_bills where carrier_id = :'c';
delete from public.carriers where id = :'c';
