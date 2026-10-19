\set ON_ERROR_STOP on
\pset footer off
\echo '>>> Posted to Edenred: kept from the export and from a PDF summary page; only blanks filled by a PDF'
reset role;
select set_config('request.jwt.claims', '', false) is not null as service;
select public.wwd_upsert_invoice('00000000-0000-0000-0000-000000000001', '{"seq":"7399200","kind":"invoice","amount":5,"posted_date":"2025-11-18","source":"edenred"}') as added;
select posted_date = '2025-11-18' as from_export from public.wwd_invoices where seq = '7399200';
select (r->>'placed')::boolean as placed from public.wwd_edenred_place('00000000-0000-0000-0000-000000000001', '{"seq":"07399200","amount":5,"posted_date":"2025-12-01"}') r;
select posted_date = '2025-11-18' as pdf_does_not_overwrite from public.wwd_invoices where seq = '7399200';
select (r->>'added')::boolean as new_from_pdf from public.wwd_edenred_place('00000000-0000-0000-0000-000000000001', '{"seq":"07399201","amount":6,"posted_date":"2025-11-20"}') r;
select posted_date = '2025-11-20' and wwd_date is null as pdf_posted_date from public.wwd_invoices where seq = '7399201';
delete from public.wwd_invoices where seq in ('7399200', '7399201');
