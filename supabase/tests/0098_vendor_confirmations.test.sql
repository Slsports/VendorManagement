\set ON_ERROR_STOP on
\pset footer off
\echo '>>> Vendor confirmations: drafts per contact; the form changes land; renames and unknown vendors go to review'
reset role;
select set_config('request.jwt.claims', '', false) is not null as service;
insert into public.vendors (organization_id, name) values ('00000000-0000-0000-0000-000000000001', 'Confirm Test Vendor') returning id as v \gset
insert into public.vendors (organization_id, name) values ('00000000-0000-0000-0000-000000000001', 'Other Line Co') returning id as v2 \gset
insert into public.orders (organization_id, vendor_id, status, source) values ('00000000-0000-0000-0000-000000000001', :'v', 'paid', 'manual') returning id as o \gset
insert into public.vendor_emails (vendor_id, email, contact_name, contact_type, roles) values (:'v', 'pat@confirm.example', 'Pat Rep', 'rep', '{rep}') returning id as me \gset
insert into public.vendor_emails (vendor_id, email, contact_name, contact_type, roles) values (:'v', 'old@confirm.example', 'Old Person', 'other', '{other}') returning id as old \gset
set role authenticated;
select set_config('request.jwt.claims', '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}', false) is not null as signed_in;
select public.vendor_confirm_prepare('00000000-0000-0000-0000-000000000001', :'v') as drafts;
select public.vendor_confirm_prepare('00000000-0000-0000-0000-000000000001', :'v') as drafts_again;
select d.body like 'Hi Pat,%' as greeting, d.body like '%/confirm/%' as link from public.email_drafts d join public.vendor_confirmations c on c.id = d.confirmation_id where c.email = 'pat@confirm.example';
reset role;
select set_config('request.jwt.claims', '', false) is not null as service;
select token from public.vendor_confirmations where email = 'pat@confirm.example' \gset
select jsonb_array_length(public.vendor_confirm_get(:'token')->'people') as people_on_form;
select public.vendor_confirm_submit(:'token', jsonb_build_object(
  'me', jsonb_build_object('name', 'Pat Rep', 'title', 'Sales Manager', 'phones', '[{"number":"559-555-0100","type":"cell"}]'::jsonb, 'roles', '["rep","owner"]'::jsonb),
  'company', jsonb_build_object('name', 'Confirm Test Vendor Inc. New', 'city', 'Fresno'),
  'people', jsonb_build_array(jsonb_build_object('id', :'old', 'remove', true), jsonb_build_object('name', 'New Shipper', 'email', 'ship@confirm.example')),
  'quotes_to', jsonb_build_object('email', 'ship@confirm.example'),
  'order_methods', '["email","nuorder"]'::jsonb, 'minimum_order', '$300', 'freight_programs', 'Free freight at $1,500',
  'represents', '["Other Line Co", "Nobody Knows Inc"]'::jsonb, 'categories', '["Tackle","Camping"]'::jsonb), false) ->> 'vendor' as applied;
select contact_name, title, roles, confirmed_at is not null as confirmed, phones -> 0 ->> 'type' as phone_type from public.vendor_emails where id = :'me';
select (select count(*) from public.vendor_emails where id = :'old') as old_gone,
       (select roles from public.vendor_emails where vendor_id = :'v' and email = 'ship@confirm.example') as shipper_roles,
       (select exists (select 1 from public.vendor_emails where vendor_id = :'v2' and email = 'pat@confirm.example')) as rep_for_other,
       (select count(*) from public.review_items where entity_id = :'v' and kind in ('vendor_rename', 'vendor_form')) as reviews,
       (select array_agg(category order by category) from public.vendor_sells where vendor_id = :'v') as categories,
       (select order_methods from public.vendors where id = :'v') as methods;
select state from public.vendor_confirm_states('00000000-0000-0000-0000-000000000001') where vendor_id = :'v';
\echo '>>> a bounce marks the address bad'
insert into public.email_threads (organization_id, gmail_thread_id) values ('00000000-0000-0000-0000-000000000001', 'bounce-t') returning id as t \gset
update public.vendor_confirmations set sent_at = now() where email = 'ship@confirm.example';
insert into public.vendor_confirmations (organization_id, vendor_id, email, sent_at) values ('00000000-0000-0000-0000-000000000001', :'v', 'ship@confirm.example', now());
insert into public.emails (organization_id, thread_id, gmail_id, direction, from_email, subject, body_text, received_at)
values ('00000000-0000-0000-0000-000000000001', :'t', 'bounce-1', 'in', 'mailer-daemon@googlemail.com', 'Delivery Status Notification (Failure)', 'Address not found: ship@confirm.example', now());
select bad_email_at is not null as bad from public.vendor_emails where vendor_id = :'v' and email = 'ship@confirm.example';
delete from public.emails where gmail_id = 'bounce-1';
delete from public.email_threads where id = :'t';
delete from public.review_items where entity_id = :'v';
delete from public.email_drafts where vendor_id = :'v';
delete from public.orders where id = :'o';
delete from public.vendors where id in (:'v', :'v2');
