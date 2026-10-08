\set ON_ERROR_STOP on
\pset footer off
\echo '>>> category rules: a top level covers its subcategories; the most specific rule wins'
select public.category_covers('Camping', 'CAMPING/Coolers') as covers_sub, public.category_covers('Camping/Coolers', 'Camping') as not_up, public.category_covers('Camp', 'Camping') as not_prefix;
reset role;
insert into public.categories (organization_id, name) values ('00000000-0000-0000-0000-000000000001', 'Camping/Lighting') returning id as cl \gset
insert into public.categories (organization_id, name) values ('00000000-0000-0000-0000-000000000001', 'Camping/Coolers') returning id as cc \gset
insert into public.vendors (organization_id, name) values ('00000000-0000-0000-0000-000000000001', 'Cat Lantern Co') returning id as v1 \gset
insert into public.vendors (organization_id, name) values ('00000000-0000-0000-0000-000000000001', 'Cat Cooler Co') returning id as v2 \gset
insert into public.vendor_categories (organization_id, vendor_id, category_id) values ('00000000-0000-0000-0000-000000000001', :'v1', :'cl'), ('00000000-0000-0000-0000-000000000001', :'v2', :'cc');
insert into public.review_assignment_rules (organization_id, match_kind, match_value, assignee_id, priority) values ('00000000-0000-0000-0000-000000000001', 'department', 'Camping', '33333333-3333-3333-3333-333333333333', 30) returning id as rcamp \gset
insert into public.review_assignment_rules (organization_id, match_kind, match_value, assignee_id, priority) values ('00000000-0000-0000-0000-000000000001', 'department', 'Camping/Coolers', '22222222-2222-2222-2222-222222222222', 30);
select public.review_assignee_for('00000000-0000-0000-0000-000000000001', 'vendor_marker', 'vendor', :'v1', '{}') = '33333333-3333-3333-3333-333333333333'::uuid as lantern_to_camping_rule,
       public.review_assignee_for('00000000-0000-0000-0000-000000000001', 'vendor_marker', 'vendor', :'v2', '{}') = '22222222-2222-2222-2222-222222222222'::uuid as cooler_to_coolers_rule,
       public.review_assignee_for('00000000-0000-0000-0000-000000000001', 'category_change', 'category', null, '{"department":"CAMPING"}') = '33333333-3333-3333-3333-333333333333'::uuid as department_named;
\echo '>>> adding the rule proposes "who orders from it" for its unassigned vendors'
update public.vendors set assigned_buyer_id = null where id in (:'v1', :'v2');
select id as admin_id from public.profiles where organization_id = '00000000-0000-0000-0000-000000000001' and role = 'admin' and is_active order by created_at limit 1 \gset
set role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', :'admin_id', 'role', 'authenticated')::text, false) is not null as as_admin;
select public.propose_category_assignments(:'rcamp') as proposed;
reset role;
select v.name, r.details->>'proposed_assignee_id' = '33333333-3333-3333-3333-333333333333' as to_tj from public.review_items r join public.vendors v on v.id = r.entity_id
 where r.kind = 'vendor_assignment' and r.entity_id in (:'v1', :'v2') order by v.name;
