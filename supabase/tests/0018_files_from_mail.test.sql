\set ON_ERROR_STOP on
\pset footer off
\echo '>>> files from mail: the newest price list is current, the older one stays as history'
reset role;
insert into public.vendors (organization_id, name) values ('00000000-0000-0000-0000-000000000001', 'Files Test Co') returning id as fv \gset
insert into public.vendor_links (organization_id, vendor_id, kind, label, url, received_at, source) values
  ('00000000-0000-0000-0000-000000000001', :'fv', 'price_list', 'Spring 2026 price list', 'https://x.example/2026.pdf', '2026-02-01', 'email'),
  ('00000000-0000-0000-0000-000000000001', :'fv', 'price_list', 'Fall 2026 price list', 'https://x.example/fall.pdf', '2026-08-01', 'email'),
  ('00000000-0000-0000-0000-000000000001', :'fv', 'catalog', '2026 catalog', 'https://x.example/cat.pdf', '2026-01-01', 'manual');
select label, is_current from public.vendor_links where vendor_id = :'fv' order by label;
\echo '>>> an older one arriving later does not take over'
insert into public.vendor_links (organization_id, vendor_id, kind, label, url, received_at, source) values ('00000000-0000-0000-0000-000000000001', :'fv', 'price_list', '2025 price list', 'https://x.example/2025.pdf', '2025-06-01', 'email');
select label, is_current from public.vendor_links where vendor_id = :'fv' and kind = 'price_list' order by received_at;
