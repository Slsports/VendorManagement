\set ON_ERROR_STOP on
\pset footer off
\echo '>>> Invoice checks and Create PO tasks VMS assigns go to logistics; confirmations and hand-picked ones stay'
reset role;
select set_config('request.jwt.claims', '', false) is not null as service;
insert into auth.users (id, email) values ('77777777-7777-7777-7777-777777777777', 'logistics-test@example.com') on conflict do nothing;
insert into public.profiles (id, organization_id, email, full_name, role, handles_logistics)
values ('77777777-7777-7777-7777-777777777777', '00000000-0000-0000-0000-000000000001', 'logistics-test@example.com', 'Logistics Test', 'manager', true)
on conflict (id) do update set handles_logistics = true;
update public.profiles set handles_logistics = false where organization_id = '00000000-0000-0000-0000-000000000001' and id <> '77777777-7777-7777-7777-777777777777';
insert into public.vendors (organization_id, name) values ('00000000-0000-0000-0000-000000000001', 'Logistics Test Vendor') returning id as v \gset
insert into public.vendor_links (organization_id, vendor_id, kind, label, url) values ('00000000-0000-0000-0000-000000000001', :'v', 'invoice', 'Inv', 'https://example.com/i') returning id as d \gset
insert into public.vendor_links (organization_id, vendor_id, kind, label, url) values ('00000000-0000-0000-0000-000000000001', :'v', 'confirmation', 'Conf', 'https://example.com/c') returning id as d2 \gset
insert into public.order_checks (organization_id, vendor_id, kind, document_id, status, assigned_to)
values ('00000000-0000-0000-0000-000000000001', :'v', 'invoice', :'d', 'to_review', '11111111-1111-1111-1111-111111111111') returning id as inv \gset
insert into public.order_checks (organization_id, vendor_id, kind, document_id, status, assigned_to)
values ('00000000-0000-0000-0000-000000000001', :'v', 'confirmation', :'d2', 'to_review', '11111111-1111-1111-1111-111111111111') returning id as conf \gset
select (select assigned_to from public.order_checks where id = :'inv') = '77777777-7777-7777-7777-777777777777' as invoice_to_logistics,
       (select assigned_to from public.order_checks where id = :'conf') = '11111111-1111-1111-1111-111111111111' as confirmation_stays;
insert into public.tasks (organization_id, title, assigned_to, vendor_id, auto_key) values ('00000000-0000-0000-0000-000000000001', 'Create PO: test', '11111111-1111-1111-1111-111111111111', :'v', 'create_po:test-175') returning assigned_to = '77777777-7777-7777-7777-777777777777' as po_task_to_logistics;
-- a person handing the invoice to someone else is kept
set role authenticated;
select set_config('request.jwt.claims', '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}', false) is not null as admin_in;
select public.order_check_action(:'inv', 'assign', null, '11111111-1111-1111-1111-111111111111');
reset role;
select set_config('request.jwt.claims', '', false) is not null as service;
select (select assigned_to from public.order_checks where id = :'inv') = '11111111-1111-1111-1111-111111111111' as hand_pick_kept;
delete from public.tasks where auto_key = 'create_po:test-175';
delete from public.order_checks where id in (:'inv', :'conf');
delete from public.vendor_links where id in (:'d', :'d2');
delete from public.vendors where id = :'v';
delete from public.profiles where id = '77777777-7777-7777-7777-777777777777';
