\set ON_ERROR_STOP on
\pset footer off
\echo '>>> Confirmation email: only people we know; former contacts off the form; removed on the form = former, not deleted'
reset role;
select set_config('request.jwt.claims', '', false) is not null as service;
insert into public.vendors (organization_id, name) values ('00000000-0000-0000-0000-000000000001', 'KNOWN TEST CO') returning id as v \gset
insert into public.orders (organization_id, vendor_id, status, source) values ('00000000-0000-0000-0000-000000000001', :'v', 'paid', 'manual');
insert into public.vendor_emails (vendor_id, email, contact_name, contact_type, roles) values (:'v', 'ours@known.example', 'Our Person', 'rep', '{rep}') returning id as ours \gset
insert into public.vendor_emails (vendor_id, email, contact_name, contact_type, roles, source) values (:'v', 'portal@known.example', 'Portal Person', 'rep', '{rep}', 'wwd_portal') returning id as portal \gset
insert into public.vendor_emails (vendor_id, email, contact_name, contact_type, roles, former_at) values (:'v', 'gone@known.example', 'Gone Person', 'rep', '{rep}', now()) returning id as gone \gset
insert into public.vendor_emails (vendor_id, email, contact_name, contact_type, roles) values (:'v', 'leaving@known.example', 'Leaving Person', 'ap', '{ap}') returning id as leaving \gset
set role authenticated;
select set_config('request.jwt.claims', '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}', false) is not null as signed_in;
select public.vendor_confirm_prepare('00000000-0000-0000-0000-000000000001', :'v') = 2 as two_known_people;
reset role;
select set_config('request.jwt.claims', '', false) is not null as service;
select array_agg(email order by email) = array['leaving@known.example', 'ours@known.example'] as sent_to from public.vendor_confirmations where vendor_id = :'v';
select token from public.vendor_confirmations where email = 'ours@known.example' \gset
-- the form shows the portal person (so they can remove them) but not the former one
select (select array_agg(x->>'email' order by x->>'email') from jsonb_array_elements(public.vendor_confirm_get(:'token')->'people') x)
       = array['leaving@known.example', 'ours@known.example', 'portal@known.example'] as form_people;
select public.vendor_confirm_submit(:'token', jsonb_build_object('me', jsonb_build_object('name', 'Our Person'),
  'people', jsonb_build_array(jsonb_build_object('id', :'leaving', 'remove', true))), false) is not null as submitted;
select former_at is not null as removed_is_former from public.vendor_emails where id = :'leaving';
delete from public.vendor_confirmations where vendor_id = :'v';
delete from public.email_drafts where vendor_id = :'v';
delete from public.orders where vendor_id = :'v';
delete from public.vendors where id = :'v';
