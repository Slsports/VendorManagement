\set ON_ERROR_STOP on
\pset footer off
\echo '>>> item rules: a type rule and an item rule; an item rule without a Vendor ID is refused, a duplicate type is refused (expect 2 errors)'
set role authenticated;
select set_config('request.jwt.claims', '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}', false);
insert into public.vendors (organization_id, name) values ('00000000-0000-0000-0000-000000000001', 'Item Rule Test Co') returning id as irv \gset
insert into public.vendor_item_rules (organization_id, vendor_id, scope, name, rule, reason, source, as_of) values ('00000000-0000-0000-0000-000000000001', :'irv', 'type', 'Squish', 'stop', 'Weakest format five years running', 'test', '2026-09-28') returning scope, name, rule;
insert into public.vendor_item_rules (organization_id, vendor_id, scope, vendor_item_id, name, rule) values ('00000000-0000-0000-0000-000000000001', :'irv', 'item', '83030', 'Bouncer Black Panther', 'stop') returning vendor_item_id, rule;
\set ON_ERROR_STOP off
insert into public.vendor_item_rules (organization_id, vendor_id, scope, name, rule) values ('00000000-0000-0000-0000-000000000001', :'irv', 'item', 'No id item', 'keep');
insert into public.vendor_item_rules (organization_id, vendor_id, scope, name, rule) values ('00000000-0000-0000-0000-000000000001', :'irv', 'type', 'SQUISH', 'keep');
\set ON_ERROR_STOP on
select count(*) as rules from public.vendor_item_rules where vendor_id = :'irv';
reset role;
