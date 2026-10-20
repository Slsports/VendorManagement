\set ON_ERROR_STOP on
\pset footer off
\echo '>>> A person confirming an order: the shipping email in Drafts and the Ship and receive task for logistics'
reset role;
select set_config('request.jwt.claims', '', false) is not null as service;
insert into auth.users (id, email) values ('77777777-7777-7777-7777-777777777213', 'ship-test@example.com') on conflict do nothing;
insert into public.profiles (id, organization_id, email, full_name, role, handles_logistics)
values ('77777777-7777-7777-7777-777777777213', '00000000-0000-0000-0000-000000000001', 'ship-test@example.com', 'Ship Test', 'manager', true)
on conflict (id) do update set handles_logistics = true;
update public.profiles set handles_logistics = false where organization_id = '00000000-0000-0000-0000-000000000001' and id <> '77777777-7777-7777-7777-777777777213';
insert into public.vendors (organization_id, name) values ('00000000-0000-0000-0000-000000000001', 'SHIP213 VENDOR') returning id as v \gset
insert into public.vendors (organization_id, name, web_orders) values ('00000000-0000-0000-0000-000000000001', 'SHIP213 WEB', true) returning id as w \gset
insert into public.vendor_emails (organization_id, vendor_id, email, contact_name, roles) values ('00000000-0000-0000-0000-000000000001', :'v', 'ship213@example.com', 'Pat Shipper', array['orders']::public.contact_type[]);
insert into public.orders (organization_id, vendor_id, status, po_number, order_date) values ('00000000-0000-0000-0000-000000000001', :'v', 'open', 'SHIP102026', current_date) returning id as o \gset
insert into public.orders (organization_id, vendor_id, status, order_date) values ('00000000-0000-0000-0000-000000000001', :'w', 'open', current_date) returning id as ow \gset
insert into public.orders (organization_id, vendor_id, status, order_date) values ('00000000-0000-0000-0000-000000000001', :'v', 'open', current_date) returning id as oimp \gset

-- an import confirming (no person) starts nothing
update public.orders set status = 'confirmed' where id = :'oimp';
select not exists (select 1 from public.tasks where auto_key = 'ship:' || :'oimp') as import_starts_nothing;

-- a person confirming
set role authenticated;
select set_config('request.jwt.claims', '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}', false) is not null as admin_in;
update public.orders set status = 'confirmed' where id in (:'o', :'ow');
reset role;
select set_config('request.jwt.claims', '', false) is not null as service;
select assigned_to = '77777777-7777-7777-7777-777777777213' and title = 'Ship and receive: SHIP213 VENDOR, PO SHIP102026' and order_id = :'o' as task_to_logistics
  from public.tasks where auto_key = 'ship:' || :'o';
select owner_id = '77777777-7777-7777-7777-777777777213' and to_emails = array['ship213@example.com'] and body like 'Hi Pat,%PO SHIP102026%'
       and not attach_routing_letter and note like '%no routing letter uploaded yet%' as draft_made
  from public.email_drafts where order_id = :'o';
select not exists (select 1 from public.tasks where auto_key = 'ship:' || :'ow') and not exists (select 1 from public.email_drafts where order_id = :'ow') as web_orders_left_out;
-- a second start makes nothing new
select public.order_ship_start(:'o') is null and (select count(*) from public.email_drafts where order_id = :'o') = 1 as once_only;

-- a routing letter uploaded later is attached to the waiting draft
insert into public.routing_letters (organization_id, version, storage_path, file_name, email_body) values ('00000000-0000-0000-0000-000000000001', 213, 'x/ship.pdf', 'ship.pdf', 'b') returning id as l \gset
select attach_routing_letter and body like '%instructions (attached).%' and note like '%attached when it sends%' as letter_attached from public.email_drafts where order_id = :'o';

-- sent: stamped on the order
insert into public.email_threads (organization_id, gmail_thread_id, subject) values ('00000000-0000-0000-0000-000000000001', 'ship213-t', 'ship213') returning id as th \gset
insert into public.emails (organization_id, thread_id, gmail_id, direction, subject, received_at) values ('00000000-0000-0000-0000-000000000001', :'th', 'ship213-g', 'out', 'ship213', now()) returning id as e \gset
select public.order_ship_email_sent(:'o', :'e') is null as stamp;
select ship_email_sent_at is not null and ship_email_id = :'e' as order_stamped from public.orders where id = :'o';
select order_id = :'o' as email_filed from public.emails where id = :'e';

-- Mark received closes the task
set role authenticated;
select set_config('request.jwt.claims', '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}', false) is not null as admin_in;
select public.order_ship_action(:'o', 'received') is null as received_action;
reset role;
select set_config('request.jwt.claims', '', false) is not null as service;
select status = 'received' and date_received = current_date as order_received from public.orders where id = :'o';
select done_at is not null and done_note = 'Received' as task_closed from public.tasks where auto_key = 'ship:' || :'o';

delete from public.tasks where auto_key like 'ship:%' and vendor_id in (:'v', :'w');
delete from public.email_drafts where vendor_id in (:'v', :'w');
update public.orders set ship_email_id = null where id = :'o';
delete from public.emails where id = :'e';
delete from public.email_threads where id = :'th';
delete from public.routing_letters where id = :'l';
delete from public.orders where vendor_id in (:'v', :'w');
delete from public.vendor_emails where vendor_id = :'v';
delete from public.vendors where id in (:'v', :'w');
delete from public.profiles where id = '77777777-7777-7777-7777-777777777213';
