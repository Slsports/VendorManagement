\set ON_ERROR_STOP on
\pset footer off
\echo '>>> 0287: a copy of a freight bill is dropped and the kept bill keeps the email it came from'
reset role;
select set_config('request.jwt.claims', '', false) is not null as service;
insert into public.carriers (organization_id, name, role) values ('00000000-0000-0000-0000-000000000001', 'Carrier 0287', 'billing') returning id as c \gset
insert into public.email_threads (organization_id, gmail_thread_id) values ('00000000-0000-0000-0000-000000000001', 'f0287') returning id as th \gset
insert into public.emails (organization_id, thread_id, gmail_id, direction, from_email, subject, received_at)
values ('00000000-0000-0000-0000-000000000001', :'th', 'f0287-1', 'in', 'bills@carrier0287.example', 'Invoice INV-0287', now()) returning id as e \gset

\echo '>>> the bill on file (from Dropbox, with its PDF) and a copy made from the carrier email'
insert into public.freight_bills (organization_id, carrier_id, invoice_number, storage_path, file_name, status, dropbox_path)
values ('00000000-0000-0000-0000-000000000001', :'c', 'INV-0287', 'test/0287-a.pdf', 'a.pdf', 'to_match', '/Freight/a.pdf') returning id as kept \gset
insert into public.freight_bills (organization_id, carrier_id, invoice_number, email_id, storage_path, file_name, status)
values ('00000000-0000-0000-0000-000000000001', :'c', 'inv 0287', :'e', 'test/0287-b.pdf', 'b.pdf', 'to_match') returning id as copy \gset
select public.freight_bill_copy_of('00000000-0000-0000-0000-000000000001', :'c', 'INV0287', :'copy') = :'kept' as copy_of_finds_it;
select public.freight_bill_settle(:'copy', null, null) = 'duplicate:' || :'kept' as settled_as_duplicate;
select (select count(*) from public.freight_bills where carrier_id = :'c') = 1 as one_bill,
       (select email_id from public.freight_bills where id = :'kept') = :'e' as kept_has_email,
       (select dropbox_path from public.freight_bills where id = :'kept') = '/Freight/a.pdf' as kept_dropbox_path;

\echo '>>> a waiting bill with no PDF takes the copy''s PDF and lines'
insert into public.freight_bills (organization_id, carrier_id, invoice_number, status) values ('00000000-0000-0000-0000-000000000001', :'c', 'W0287', 'needs_pdf') returning id as waiting \gset
insert into public.freight_bills (organization_id, carrier_id, invoice_number, storage_path, file_name, status) values ('00000000-0000-0000-0000-000000000001', :'c', 'W-0287', 'test/0287-c.pdf', 'c.pdf', 'to_match') returning id as up \gset
insert into public.freight_bill_lines (organization_id, bill_id, shipper_name, amount) values ('00000000-0000-0000-0000-000000000001', :'up', 'SHIPPER 0287', 12);
select public.freight_bill_settle(:'up', null, null) = 'filled:' || :'waiting' as filled;
select (select storage_path from public.freight_bills where id = :'waiting') = 'test/0287-c.pdf' as took_pdf,
       (select count(*) from public.freight_bill_lines where bill_id = :'waiting') = 1 as took_lines;

\echo '>>> a different invoice is a new bill'
insert into public.freight_bills (organization_id, carrier_id, invoice_number, status) values ('00000000-0000-0000-0000-000000000001', :'c', 'OTHER0287', 'needs_pdf') returning id as other \gset
select public.freight_bill_settle(:'other', null, null) = 'new' as new_bill;

delete from public.freight_bills where carrier_id = :'c';
delete from public.emails where gmail_id = 'f0287-1';
delete from public.email_threads where id = :'th';
delete from public.carriers where id = :'c';
