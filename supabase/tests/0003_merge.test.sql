\set ON_ERROR_STOP on
\pset footer off
\echo '>>> merge: create two vendors as JW (buyer) and merge with route faire; expect aliases/routes/contacts combined, second inactive'
set role authenticated;
select set_config('request.jwt.claims', '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}', false);
insert into public.vendors (organization_id, name, lightspeed_name, aliases, phone) values ('00000000-0000-0000-0000-000000000001', 'Crosman', 'CROSMAN - WWD', '{"CROSMAN - WWD"}', null) returning id as keep \gset
insert into public.vendors (organization_id, name, lightspeed_name, aliases, phone, needs_review) values ('00000000-0000-0000-0000-000000000001', 'Crossman', 'CROSSMAN', '{"CROSSMAN"}', '555-1111', true) returning id as remove \gset
insert into public.vendor_billing_routes (vendor_id, route, is_default) values (:'keep', 'worldwide', true), (:'remove', 'faire', true);
insert into public.vendor_emails (vendor_id, email, contact_type) values (:'remove', 'rep@crosman.example', 'rep');
insert into public.review_items (organization_id, kind, entity_type, entity_id, title, details) values ('00000000-0000-0000-0000-000000000001', 'vendor_duplicate', 'vendor', :'keep', 'dup', jsonb_build_object('other_vendor_id', :'remove'));
select public.merge_vendors(:'keep', :'remove', 'faire') = :'keep'::uuid as merged_into_keep;
select name, aliases, phone, is_active, needs_review from public.vendors where id = :'keep';
select is_active, merged_into_id = :'keep'::uuid as points_to_keep from public.vendors where id = :'remove';
select route, is_default from public.vendor_billing_routes where vendor_id = :'keep' order by route;
select count(*) as contacts_on_keep from public.vendor_emails where vendor_id = :'keep';
select status from public.review_items where entity_id = :'keep' and kind = 'vendor_duplicate';
\echo '>>> ledger: one manual confirmed row, merged LS name CROSSMAN into CROSMAN - WWD'
select source, status, kept_lightspeed_name, merged_lightspeed_name, route from public.vendor_merges where kept_vendor_id = :'keep';
\echo '>>> unmerge: split CROSSMAN back out as direct; expect the old row revived, flagged, route direct, ledger split'
select public.unmerge_vendor(:'keep', 'CROSSMAN', 'direct') = :'remove'::uuid as revived_old_row;
select name, lightspeed_name, is_active, needs_review, merged_into_id from public.vendors where id = :'remove';
select route, is_default from public.vendor_billing_routes where vendor_id = :'remove' order by route;
select 'CROSSMAN' = any(aliases) as alias_still_on_keep from public.vendors where id = :'keep';
select status from public.vendor_merges where kept_vendor_id = :'keep';
\echo '>>> import-style merge: pending ledger rows, confirm with route worldwide clears flag and item'
insert into public.vendors (organization_id, name, lightspeed_name, aliases, needs_review, review_note) values ('00000000-0000-0000-0000-000000000001', 'Coghlans', 'COGHLANS', '{"COGHLANS - WWD","COGHLANS FAIRE"}', true, 'Merged. Please confirm.') returning id as stan \gset
insert into public.review_items (organization_id, kind, entity_type, entity_id, title, details) values ('00000000-0000-0000-0000-000000000001', 'vendor_merge', 'vendor', :'stan', 'merged', '{"lightspeed_names":["COGHLANS","COGHLANS - WWD","COGHLANS FAIRE"]}') returning id as stan_item \gset
reset role;
insert into public.vendor_merges (organization_id, kept_vendor_id, kept_name, kept_lightspeed_name, merged_name, merged_lightspeed_name, source, status)
values ('00000000-0000-0000-0000-000000000001', :'stan', 'Coghlans', 'COGHLANS', 'COGHLANS - WWD', 'COGHLANS - WWD', 'import', 'pending'),
       ('00000000-0000-0000-0000-000000000001', :'stan', 'Coghlans', 'COGHLANS', 'COGHLANS FAIRE', 'COGHLANS FAIRE', 'import', 'pending');
set role authenticated;
select set_config('request.jwt.claims', '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}', false);
\echo '>>> split one name first: item stays pending with 2 names, new vendor gets faire from its name'
select public.unmerge_vendor(:'stan', 'COGHLANS FAIRE') as split_id \gset
select name, lightspeed_name, needs_review from public.vendors where id = :'split_id';
select route from public.vendor_billing_routes where vendor_id = :'split_id';
select status, details->'lightspeed_names' as names from public.review_items where id = :'stan_item';
select status from public.vendor_merges where kept_vendor_id = :'stan' order by merged_lightspeed_name;
select public.confirm_vendor_merge(:'stan', 'worldwide');
select needs_review, review_note from public.vendors where id = :'stan';
select route, is_default from public.vendor_billing_routes where vendor_id = :'stan';
select status, resolution_note from public.review_items where id = :'stan_item';
select merged_lightspeed_name, status, route from public.vendor_merges where kept_vendor_id = :'stan' order by merged_lightspeed_name;
\echo '>>> resolve_review_item clears the flag when nothing else is pending'
update public.vendors set needs_review = true where id = :'split_id';
insert into public.review_items (organization_id, kind, entity_type, entity_id, title, details) values ('00000000-0000-0000-0000-000000000001', 'vendor_duplicate', 'vendor', :'split_id', 'dup', jsonb_build_object('other_vendor_id', :'stan')) returning id as dup_item \gset
select public.resolve_review_item(:'dup_item', 'accepted', 'Keep both');
select needs_review from public.vendors where id = :'split_id';
\echo '>>> buyer can tick done in LS'
update public.vendor_merges set ls_done_at = now(), ls_done_by = '22222222-2222-2222-2222-222222222222' where kept_vendor_id = :'stan' and status = 'confirmed' returning ls_done_at is not null as done;
\echo '>>> viewer cannot merge or resolve (expect 2 errors)'
select set_config('request.jwt.claims', '{"sub":"44444444-4444-4444-4444-444444444444","role":"authenticated"}', false);
\set ON_ERROR_STOP off
select public.merge_vendors(:'keep', :'remove');
select public.resolve_review_item(:'dup_item', 'rejected');
\set ON_ERROR_STOP on
reset role;
\echo '>>> directory: a show-list row answers route by name or domain; names normalise'
set role authenticated;
select set_config('request.jwt.claims', '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}', false);
insert into public.vendor_directory (organization_id, source, name, email_domain) values ('00000000-0000-0000-0000-000000000001', 'wwd_show_test', 'Big Agnes, Inc.', 'bigagnes.com') returning name_key;
select public.directory_route_for('00000000-0000-0000-0000-000000000001', 'BIG AGNES INC') as by_name, public.directory_route_for('00000000-0000-0000-0000-000000000001', 'someone', 'BigAgnes.com') as by_domain, public.directory_route_for('00000000-0000-0000-0000-000000000001', 'Nobody') as unknown;
reset role;
