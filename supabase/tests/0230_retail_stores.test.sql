\set ON_ERROR_STOP on
\pset footer off
\echo '>>> Retail stores: no contact check card, no update email'
reset role;
select set_config('request.jwt.claims', '', false) is not null as service;
insert into public.vendors (organization_id, name, is_retail_store) values ('00000000-0000-0000-0000-000000000001', 'RS230 BIG BOX', true) returning id as v \gset
insert into public.vendor_emails (organization_id, vendor_id, email, contact_name, source) values ('00000000-0000-0000-0000-000000000001', :'v', 'pres@rs230.test', 'Pat President', 'wwd_portal');
select (public.portal_contacts_review('00000000-0000-0000-0000-000000000001')) is not null as reviewed;
select count(*) = 0 as no_card_for_a_retail_store from public.review_items where entity_id = :'v' and kind = 'portal_contact' and status = 'pending';
update public.vendors set is_retail_store = false where id = :'v';
select (public.portal_contacts_review('00000000-0000-0000-0000-000000000001')) is not null as reviewed_again;
select count(*) = 1 as card_once_not_retail from public.review_items where entity_id = :'v' and kind = 'portal_contact' and status = 'pending';
update public.vendors set is_retail_store = true where id = :'v';
select (public.portal_contacts_review('00000000-0000-0000-0000-000000000001')) is not null as reviewed_third;
select count(*) = 0 as card_closes_when_ticked from public.review_items where entity_id = :'v' and kind = 'portal_contact' and status = 'pending';
-- the update email skips it (a known contact, so only the tick keeps it out)
insert into public.vendor_emails (organization_id, vendor_id, email, contact_name) values ('00000000-0000-0000-0000-000000000001', :'v', 'buyer@rs230.test', 'Known Person');
select set_config('request.jwt.claims', '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}', false) is not null as dana;
set role authenticated;
select public.vendor_confirm_prepare('00000000-0000-0000-0000-000000000001', :'v') = 0 as no_update_email;
reset role;
select set_config('request.jwt.claims', '', false) is not null as service2;
delete from public.review_items where entity_id = :'v';
delete from public.vendor_emails where vendor_id = :'v';
delete from public.vendors where id = :'v';
