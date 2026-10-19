\set ON_ERROR_STOP on
\pset footer off
\echo '>>> Edenred Posted Date: a new WWD invoice from a PDF does not take it as its WWD date'
reset role;
select set_config('request.jwt.claims', '', false) is not null as service;
select (r->>'added')::boolean as added
  from public.wwd_edenred_place('00000000-0000-0000-0000-000000000001', '{"seq":"07399198","vendor_invoice_number":"P-1","vendor_name":"Postedtest Co","amount":12,"posted_date":"2025-11-20"}') r;
select wwd_date is null as no_posted_date from public.wwd_invoices where seq = '7399198';
delete from public.wwd_invoices where seq = '7399198';
