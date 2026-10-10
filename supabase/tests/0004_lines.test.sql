\set ON_ERROR_STOP on
\pset footer off
\echo '>>> lines: rep group + catalog-only line + show appearance, as JW (buyer)'
set role authenticated;
select set_config('request.jwt.claims', '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}', false);
insert into public.rep_groups (organization_id, name, contact_name, email) values ('00000000-0000-0000-0000-000000000001', 'DandyLines / Diverse Marketing', 'Donna Hoffman', 'donna@example.com') returning id as grp \gset
insert into public.vendor_directory (organization_id, source, name, route, rep_group_id, catalog_url, specials, specials_label, zero_upcharge, email)
  values ('00000000-0000-0000-0000-000000000001', 'rep_dandylines', 'Kurt Adler', 'worldwide', :'grp', 'https://example.com/kurt', '8% Discount', 'Fall 2026', true, 'rep@kurtadler.example') returning id as line \gset
insert into public.show_appearances (organization_id, show_code, show_label, line_id, booth, exhibitor) values ('00000000-0000-0000-0000-000000000001', 'wwd_fall_2026', 'Fall 2026', :'line', '1315', 'DandyLines/Diverse Marketing') returning booth;
\echo '>>> same line twice must FAIL (one row per line per org)'
\set ON_ERROR_STOP off
insert into public.vendor_directory (organization_id, source, name) values ('00000000-0000-0000-0000-000000000001', 'other', 'KURT ADLER');
\set ON_ERROR_STOP on
\echo '>>> promote: vendor created with rep group, route, zero upcharge, catalog link, rep contact; show row re-pointed'
select public.promote_line_to_vendor(:'line') as vid \gset
select name, rep_group_id = :'grp'::uuid as has_group, wwd_zero_upcharge from public.vendors where id = :'vid';
select route, is_default from public.vendor_billing_routes where vendor_id = :'vid';
select kind, label, url, season_label from public.vendor_links where vendor_id = :'vid';
select email, contact_type from public.vendor_emails where vendor_id = :'vid';
select matched_vendor_id = :'vid'::uuid as line_linked from public.vendor_directory where id = :'line';
select vendor_id = :'vid'::uuid as show_linked from public.show_appearances where line_id = :'line';
\echo '>>> promoting again returns the same vendor'
select public.promote_line_to_vendor(:'line') = :'vid'::uuid as same_vendor;
\echo '>>> links: uploaded file row for a vendor; a row with neither url nor file must FAIL'
insert into public.vendor_links (organization_id, vendor_id, kind, label, storage_path, file_name, mime_type, created_by)
  values ('00000000-0000-0000-0000-000000000001', :'vid', 'price_list', 'Fall 2026 price list', '00000000-0000-0000-0000-000000000001/' || :'vid' || '/x.pdf', 'x.pdf', 'application/pdf', '22222222-2222-2222-2222-222222222222') returning kind;
\set ON_ERROR_STOP off
insert into public.vendor_links (organization_id, vendor_id, kind, label) values ('00000000-0000-0000-0000-000000000001', :'vid', 'other', 'nothing');
\set ON_ERROR_STOP on
\echo '>>> storage: object under our org folder allowed, other org denied (expect 1 error)'
insert into storage.objects (bucket_id, name) values ('vendor-files', '00000000-0000-0000-0000-000000000001/' || :'vid' || '/x.pdf') returning bucket_id;
\set ON_ERROR_STOP off
insert into storage.objects (bucket_id, name) values ('vendor-files', '00000000-0000-0000-0000-000000000002/x/y.pdf');
\set ON_ERROR_STOP on
\echo '>>> rename proposal: apply with an edited name; old name and suffix kept as aliases, rep group set'
insert into public.vendors (organization_id, name, lightspeed_name, aliases) values ('00000000-0000-0000-0000-000000000001', 'POLAR MAGNETICS - Maryellen', 'POLAR MAGNETICS - Maryellen', '{}') returning id as pm \gset
insert into public.rep_groups (organization_id, name) values ('00000000-0000-0000-0000-000000000001', 'Maryellen Reynolds') returning id as mgrp \gset
insert into public.review_items (organization_id, kind, entity_type, entity_id, title, details)
  values ('00000000-0000-0000-0000-000000000001', 'vendor_rename', 'vendor', :'pm', 'Clean up name', jsonb_build_object('current_name', 'POLAR MAGNETICS - Maryellen', 'new_name', 'POLAR MAGNETICS', 'alias', 'Maryellen', 'rep_group_name', 'Maryellen Reynolds', 'rep_group_id', :'mgrp')) returning id as ritem \gset
select public.apply_vendor_rename(:'ritem', 'Polar Magnetics');
select name, aliases, rep_group_id = :'mgrp'::uuid as grouped from public.vendors where id = :'pm';
select status, resolution_note from public.review_items where id = :'ritem';
\echo '>>> viewer cannot promote or rename (expect 2 errors)'
select set_config('request.jwt.claims', '{"sub":"44444444-4444-4444-4444-444444444444","role":"authenticated"}', false);
\set ON_ERROR_STOP off
select public.promote_line_to_vendor(:'line');
select public.apply_vendor_rename(:'ritem');
\set ON_ERROR_STOP on
reset role;
