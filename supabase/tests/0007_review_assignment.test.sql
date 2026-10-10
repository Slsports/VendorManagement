\set ON_ERROR_STOP on
\pset footer off
\echo '>>> review assignment: Dana adds a fishing rule to JW; a fishing vendor review lands on JW, a plain one stays unassigned'
set role authenticated;
select set_config('request.jwt.claims', '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}', false);
insert into public.review_assignment_rules (organization_id, match_kind, assignee_id, priority, created_by) values ('00000000-0000-0000-0000-000000000001', 'fishing', '22222222-2222-2222-2222-222222222222', 20, '11111111-1111-1111-1111-111111111111') returning match_kind, is_active;
insert into public.vendors (organization_id, name, is_fishing) values ('00000000-0000-0000-0000-000000000001', 'Assign Test Tackle', true) returning id as fishv \gset
insert into public.vendors (organization_id, name) values ('00000000-0000-0000-0000-000000000001', 'Assign Test Plain') returning id as plainv \gset
insert into public.review_items (organization_id, kind, entity_type, entity_id, title) values ('00000000-0000-0000-0000-000000000001', 'vendor_duplicate', 'vendor', :'fishv', 'dup') returning assigned_to = '22222222-2222-2222-2222-222222222222'::uuid as to_jw, assigned_at is not null as stamped;
insert into public.review_items (organization_id, kind, entity_type, entity_id, title) values ('00000000-0000-0000-0000-000000000001', 'vendor_duplicate', 'vendor', :'plainv', 'dup2') returning id as plain_item \gset
select assigned_to is null as plain_unassigned from public.review_items where id = :'plain_item';
\echo '>>> the other vendor of a duplicate counts too; a FISHING department in details counts; a rule with a vendor wins over fishing'
insert into public.review_items (organization_id, kind, entity_type, entity_id, title, details) values ('00000000-0000-0000-0000-000000000001', 'vendor_duplicate', 'vendor', :'plainv', 'dup3', jsonb_build_object('other_vendor_id', :'fishv')) returning assigned_to = '22222222-2222-2222-2222-222222222222'::uuid as to_jw_via_other;
insert into public.review_items (organization_id, kind, title, details) values ('00000000-0000-0000-0000-000000000001', 'category_change', 'cat', '{"department":"Fishing"}') returning assigned_to = '22222222-2222-2222-2222-222222222222'::uuid as to_jw_by_department;
insert into public.review_assignment_rules (organization_id, match_kind, vendor_id, assignee_id, priority) values ('00000000-0000-0000-0000-000000000001', 'vendor', :'fishv', '33333333-3333-3333-3333-333333333333', 20) returning match_kind;
insert into public.review_items (organization_id, kind, entity_type, entity_id, title) values ('00000000-0000-0000-0000-000000000001', 'vendor_rename', 'vendor', :'fishv', 'rename') returning assigned_to = '33333333-3333-3333-3333-333333333333'::uuid as vendor_rule_wins;
\echo '>>> a fallback catches the rest; apply_review_rules fills the unassigned items (the plain one, plus any left pending by earlier tests)'
insert into public.review_assignment_rules (organization_id, match_kind, assignee_id) values ('00000000-0000-0000-0000-000000000001', 'fallback', '33333333-3333-3333-3333-333333333333') returning priority;
insert into public.review_items (organization_id, kind, title) values ('00000000-0000-0000-0000-000000000001', 'vendor_marker', 'misc') returning assigned_to = '33333333-3333-3333-3333-333333333333'::uuid as to_fallback;
select public.apply_review_rules('00000000-0000-0000-0000-000000000001') as changed;
select assigned_to = '33333333-3333-3333-3333-333333333333'::uuid as plain_now_tj from public.review_items where id = :'plain_item';
\echo '>>> a bad rule is refused (department with no value)'
\set ON_ERROR_STOP off
insert into public.review_assignment_rules (organization_id, match_kind, assignee_id) values ('00000000-0000-0000-0000-000000000001', 'department', '33333333-3333-3333-3333-333333333333');
\set ON_ERROR_STOP on
\echo '>>> JW (buyer) reassigns by hand to himself, then clears it'
select set_config('request.jwt.claims', '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}', false);
select public.assign_review_item(:'plain_item', '22222222-2222-2222-2222-222222222222');
select assigned_to = '22222222-2222-2222-2222-222222222222'::uuid as reassigned, assigned_at is not null as stamped from public.review_items where id = :'plain_item';
select public.assign_review_item(:'plain_item', null);
select assigned_to is null as cleared, assigned_at is null as unstamped from public.review_items where id = :'plain_item';
\echo '>>> JW cannot add rules or apply them; the viewer cannot assign (expect 3 errors)'
\set ON_ERROR_STOP off
insert into public.review_assignment_rules (organization_id, match_kind, assignee_id) values ('00000000-0000-0000-0000-000000000001', 'fallback', '22222222-2222-2222-2222-222222222222');
select public.apply_review_rules('00000000-0000-0000-0000-000000000001');
select set_config('request.jwt.claims', '{"sub":"44444444-4444-4444-4444-444444444444","role":"authenticated"}', false);
select public.assign_review_item(:'plain_item', '44444444-4444-4444-4444-444444444444');
\set ON_ERROR_STOP on
reset role;
