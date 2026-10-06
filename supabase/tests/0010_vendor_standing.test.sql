\set ON_ERROR_STOP on
\pset footer off
\echo '>>> standing: last resort with tags; do_not_order flag follows standing both ways; ok clears tags; bad tag refused (expect 1 error)'
set role authenticated;
select set_config('request.jwt.claims', '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}', false);
insert into public.vendors (organization_id, name, standing, standing_tags, do_not_order_reason) values ('00000000-0000-0000-0000-000000000001', 'Standing Test Co', 'last_resort', '{shipping_fees,damaged_goods}', 'Freight is wild and half of it arrives broken') returning standing, standing_tags, do_not_order as flag;
update public.vendors set standing = 'do_not_order' where name = 'Standing Test Co' returning standing, do_not_order as flag;
update public.vendors set do_not_order = false where name = 'Standing Test Co' returning standing, standing_tags, do_not_order as flag;
insert into public.vendors (organization_id, name, do_not_order, do_not_order_reason) values ('00000000-0000-0000-0000-000000000001', 'Standing Old Screen Co', true, 'legacy flag') returning standing, do_not_order as flag;
select standing, standing_tags, standing_reason from public.vendor_scorecards('00000000-0000-0000-0000-000000000001', (select id from public.vendors where name = 'Standing Old Screen Co'));
\set ON_ERROR_STOP off
update public.vendors set standing = 'last_resort', standing_tags = '{rude}' where name = 'Standing Test Co';
\set ON_ERROR_STOP on
reset role;
