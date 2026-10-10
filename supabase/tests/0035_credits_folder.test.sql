\set ON_ERROR_STOP on
\pset footer off
\echo '>>> a credit memo is its own kind of document'
reset role;
insert into public.vendors (organization_id, name) values ('00000000-0000-0000-0000-000000000001', 'Credit Docs Co') returning id as cv \gset
insert into public.vendor_links (organization_id, vendor_id, kind, label, url) values ('00000000-0000-0000-0000-000000000001', :'cv', 'credit', 'Credit memo 84731', 'https://x.example/c') returning kind;
