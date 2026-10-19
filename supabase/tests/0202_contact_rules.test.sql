\set ON_ERROR_STOP on
\pset footer off
\echo '>>> Contact rules: portal people unconfirmed until our mail about the vendor; one card per vendor; former keeps them; deleted stay deleted'
reset role;
select set_config('request.jwt.claims', '', false) is not null as service;
insert into public.vendors (organization_id, name) values ('00000000-0000-0000-0000-000000000001', 'RULETEST RODS') returning id as v \gset
insert into public.vendor_emails (vendor_id, email, contact_name, contact_type, roles, source) values
  (:'v', 'old.rep@ruletest.com', 'Old Rep', 'rep', array['rep']::public.contact_type[], 'wwd_portal') returning id as old \gset
insert into public.vendor_emails (vendor_id, email, contact_name, contact_type, roles, source) values
  (:'v', 'new.rep@ruletest.com', 'New Rep', 'rep', array['rep']::public.contact_type[], 'wwd_portal') returning id as new \gset
insert into public.vendor_emails (vendor_id, email, contact_name, contact_type, roles, source) values
  (:'v', 'other.vendor@ruletest.com', 'Elsewhere', 'rep', array['rep']::public.contact_type[], 'wwd_portal') returning id as elsewhere \gset
update public.vendors set assigned_rep_contact_id = :'old' where id = :'v';
-- mail: New Rep wrote about this vendor last month; Elsewhere wrote last month, but about another vendor; Old Rep in 2022
insert into public.email_threads (organization_id, gmail_thread_id) values ('00000000-0000-0000-0000-000000000001', 'r201-a') returning id as t \gset
insert into public.emails (organization_id, gmail_id, thread_id, direction, from_email, received_at, vendor_id) values
  ('00000000-0000-0000-0000-000000000001', 'r201-1', :'t', 'in', 'New.Rep@ruletest.com', now() - interval '30 days', :'v'),
  ('00000000-0000-0000-0000-000000000001', 'r201-2', :'t', 'in', 'other.vendor@ruletest.com', now() - interval '30 days', null),
  ('00000000-0000-0000-0000-000000000001', 'r201-3', :'t', 'out', 'orders@example.com', now() - interval '4 years', :'v');
update public.emails set to_emails = array['old.rep@ruletest.com'] where gmail_id = 'r201-3';

select public.contacts_refresh_mail('00000000-0000-0000-0000-000000000001') is not null as refreshed;
select last_vendor_mail_at is not null and not public.portal_contact_unconfirmed(ve) as new_rep_confirmed from public.vendor_emails ve where id = :'new';
select last_mail_at is not null and last_vendor_mail_at is null and public.portal_contact_unconfirmed(ve) as elsewhere_unconfirmed from public.vendor_emails ve where id = :'elsewhere';
select first_mail_at < now() - interval '3 years' and public.portal_contact_unconfirmed(ve) as old_rep_unconfirmed from public.vendor_emails ve where id = :'old';

-- one card for the vendor, not one per person; running again adds none
select (public.portal_contacts_review('00000000-0000-0000-0000-000000000001')->>'cards_new')::int >= 1 as card_made;
select count(*) = 1 as one_card from public.review_items where kind = 'portal_contact' and entity_id = :'v' and status = 'pending';
select (public.portal_contacts_review('00000000-0000-0000-0000-000000000001')->>'cards_new')::int = 0 as no_second_card;

-- as Dana: Old Rep is no longer their rep (kept, unstarred); Elsewhere is kept; the card closes
set role authenticated;
select set_config('request.jwt.claims', '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}', false) is not null as dana_in;
select public.vendor_contact_set(:'old', 'former');
select public.vendor_contact_set(:'elsewhere', 'keep');
reset role;
select set_config('request.jwt.claims', '', false) is not null as service;
select former_at is not null as old_is_former from public.vendor_emails where id = :'old';
select assigned_rep_contact_id is null as unstarred from public.vendors where id = :'v';
select status = 'accepted' as card_closed from public.review_items where kind = 'portal_contact' and entity_id = :'v';

-- delete leaves a removal; deleting the whole vendor does not fail and leaves none for it
set role authenticated;
select set_config('request.jwt.claims', '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}', false) is not null as dana_again;
select public.vendor_contact_set(:'elsewhere', 'delete');
reset role;
select set_config('request.jwt.claims', '', false) is not null as service;
select count(*) = 1 as removal_kept from public.contact_removals where vendor_id = :'v' and email = 'other.vendor@ruletest.com';

-- a viewer cannot change contacts
set role authenticated;
select set_config('request.jwt.claims', '{"sub":"44444444-4444-4444-4444-444444444444","role":"authenticated"}', false) is not null as viewer_in;
do $$ begin
  perform public.vendor_contact_set((select id from public.vendor_emails where email = 'new.rep@ruletest.com'), 'former');
  raise exception 'viewer changed a contact';
exception when insufficient_privilege then null; end $$;
reset role;
select set_config('request.jwt.claims', '', false) is not null as service;

delete from public.review_items where entity_id = :'v';
delete from public.emails where gmail_id like 'r201-%';
delete from public.email_threads where gmail_thread_id = 'r201-a';
delete from public.vendors where id = :'v';
select count(*) = 0 as vendor_gone_cleanly from public.contact_removals where vendor_id = :'v';
