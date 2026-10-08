\set ON_ERROR_STOP on
\pset footer off
\echo '>>> the year folder: the season year, else the date, else when added'
select public.vendor_link_year('Fall 2027', '2026-08-01', now()) as season, public.vendor_link_year('Oct', '2025-11-02', now()) as received, public.vendor_link_year(null, null, '2024-05-05') as added;

\echo '>>> new documents get their year; moving one sets folder (kind) and year and re-marks current'
reset role;
insert into public.vendors (organization_id, name) values ('00000000-0000-0000-0000-000000000001', 'Docs Test Co') returning id as dv \gset
insert into public.vendor_links (organization_id, vendor_id, kind, label, url, season_label, received_at) values ('00000000-0000-0000-0000-000000000001', :'dv', 'price_list', 'Old list', 'https://x.example/a', 'Spring 2026', '2026-01-10') returning id as d1, doc_year \gset
insert into public.vendor_links (organization_id, vendor_id, kind, label, url, received_at) values ('00000000-0000-0000-0000-000000000001', :'dv', 'price_list', 'Invoice 1001 (misfiled)', 'https://x.example/b', '2026-09-01') returning id as d2 \gset
select label, doc_year, is_current from public.vendor_links where vendor_id = :'dv' order by label;
set role authenticated;
select set_config('request.jwt.claims', '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}', false);
select public.move_vendor_document(:'d2', 'invoice', 2025);
reset role;
select label, kind, doc_year, is_current from public.vendor_links where vendor_id = :'dv' order by label;
\echo '>>> a viewer cannot move documents (expect 1 error)'
\set ON_ERROR_STOP off
set role authenticated;
select set_config('request.jwt.claims', '{"sub":"44444444-4444-4444-4444-444444444444","role":"authenticated"}', false);
select public.move_vendor_document(:'d1', 'other', 2026);
\set ON_ERROR_STOP on
reset role;
