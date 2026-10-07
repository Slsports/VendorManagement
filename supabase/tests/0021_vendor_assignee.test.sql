\set ON_ERROR_STOP on
\pset footer off
\echo '>>> who places orders: Dana (the migration marks admins; these users came later, so mark her here); Dana marks JW; JW cannot unmark himself (expect 1 error)'
reset role;
select set_config('request.jwt.claims', '', false) is not null as as_service;
update public.profiles set places_orders = (role = 'admin') where organization_id = '00000000-0000-0000-0000-000000000001';
select email, places_orders from public.profiles where id in ('11111111-1111-1111-1111-111111111111', '22222222-2222-2222-2222-222222222222', '33333333-3333-3333-3333-333333333333') order by email;
set role authenticated;
select set_config('request.jwt.claims', '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}', false);
update public.profiles set places_orders = true where id = '22222222-2222-2222-2222-222222222222' returning places_orders as jw_orders;
select set_config('request.jwt.claims', '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}', false);
\set ON_ERROR_STOP off
update public.profiles set places_orders = false where id = '22222222-2222-2222-2222-222222222222';
\set ON_ERROR_STOP on

\echo '>>> a vendor can only go to someone who places orders (expect 1 error); a review item for it then lands on that person, not the fallback rule'
insert into public.vendors (organization_id, name, assigned_buyer_id) values ('00000000-0000-0000-0000-000000000001', 'Assignee Test Gifts', '22222222-2222-2222-2222-222222222222') returning id as av \gset
\set ON_ERROR_STOP off
update public.vendors set assigned_buyer_id = '33333333-3333-3333-3333-333333333333' where id = :'av';
\set ON_ERROR_STOP on
insert into public.review_items (organization_id, kind, entity_type, entity_id, title) values ('00000000-0000-0000-0000-000000000001', 'vendor_rename', 'vendor', :'av', 'rename') returning assigned_to = '22222222-2222-2222-2222-222222222222'::uuid as to_assignee;
\echo '>>> a one-vendor rule still wins over the assignee'
reset role;
insert into public.review_assignment_rules (organization_id, match_kind, vendor_id, assignee_id, priority) values ('00000000-0000-0000-0000-000000000001', 'vendor', :'av', '11111111-1111-1111-1111-111111111111', 10) returning id as avrule \gset
insert into public.review_items (organization_id, kind, entity_type, entity_id, title) values ('00000000-0000-0000-0000-000000000001', 'vendor_rename', 'vendor', :'av', 'rename2') returning assigned_to = '11111111-1111-1111-1111-111111111111'::uuid as rule_wins;
delete from public.review_assignment_rules where id = :'avrule';

\echo '>>> keeping the proposed person closes the assignment review; changing it on the vendor closes another'
insert into public.review_items (organization_id, kind, entity_type, entity_id, title, assigned_to) values ('00000000-0000-0000-0000-000000000001', 'vendor_assignment', 'vendor', :'av', 'Assignee Test Gifts: assigned to JW', '11111111-1111-1111-1111-111111111111') returning id as ai1 \gset
set role authenticated;
select set_config('request.jwt.claims', '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}', false);
select public.set_vendor_assignee(:'av', '22222222-2222-2222-2222-222222222222');
select status, resolution_note from public.review_items where id = :'ai1';
reset role;
insert into public.review_items (organization_id, kind, entity_type, entity_id, title) values ('00000000-0000-0000-0000-000000000001', 'vendor_assignment', 'vendor', :'av', 'again') returning id as ai2 \gset
set role authenticated;
update public.vendors set assigned_buyer_id = '11111111-1111-1111-1111-111111111111' where id = :'av';
select status, resolution_note from public.review_items where id = :'ai2';
\echo '>>> the viewer cannot assign vendors (expect 1 error)'
select set_config('request.jwt.claims', '{"sub":"44444444-4444-4444-4444-444444444444","role":"authenticated"}', false);
\set ON_ERROR_STOP off
select public.set_vendor_assignee(:'av', null);
\set ON_ERROR_STOP on
reset role;
