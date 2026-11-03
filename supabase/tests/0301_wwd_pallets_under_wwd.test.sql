\set ON_ERROR_STOP on
\pset footer off
\echo '>>> 0301: a WWD pallet line no order claims goes under WWD; the bill is done'
reset role;
select set_config('request.jwt.claims', '', false) is not null as service;
select public.wwd_self_vendor('00000000-0000-0000-0000-000000000001') as wwd \gset
insert into public.carriers (organization_id, name, role) values ('00000000-0000-0000-0000-000000000001', 'Carrier 0301', 'billing') returning id as c \gset
insert into public.freight_bills (organization_id, carrier_id, invoice_number, status, total) values ('00000000-0000-0000-0000-000000000001', :'c', 'P0301', 'to_match', 99) returning id as b \gset
insert into public.freight_bill_lines (organization_id, bill_id, shipper_name, amount) values ('00000000-0000-0000-0000-000000000001', :'b', 'WORLD WIDE DISTRIBUTORS INC', 99);
update public.freight_bills set read_at = now() where id = :'b';
select (select vendor_id from public.freight_bill_lines where bill_id = :'b') is not distinct from nullif(:'wwd', '')::uuid as under_wwd,
       (select status from public.freight_bills where id = :'b') = case when nullif(:'wwd', '') is null then 'to_match' else 'done' end as bill_done;
delete from public.freight_bills where id = :'b';
delete from public.carriers where id = :'c';
