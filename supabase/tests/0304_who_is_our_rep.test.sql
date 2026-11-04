\set ON_ERROR_STOP on
\pset footer off
\echo '>>> 0304: who is our rep'
reset role;
select set_config('request.jwt.claims', '', false) is not null as service;
insert into public.vendors (organization_id, name) values ('00000000-0000-0000-0000-000000000001', 'RR304 SLEDS') returning id as v \gset
insert into public.vendor_emails (organization_id, vendor_id, email, contact_name, contact_type, roles, source, notes)
values ('00000000-0000-0000-0000-000000000001', :'v', 'ted@rr304.example', 'Ted Test', 'other', array['other']::public.contact_type[], 'email_enrichment', 'Learned from email')
returning id as ted \gset

\echo '>>> the portal fills in what is missing on someone learned from email'
select public.wwd_portal_contact_fill(:'v', '{"email":"Ted@rr304.example","name":"Ted Test","kind":"rep","title":"Sales Manager","phones":[{"type":"work","number":"207-555-0100"}],"territory":"Local"}', '99304') as filled;
select title = 'Sales Manager' and roles = array['rep']::public.contact_type[] and contact_type = 'rep' and jsonb_array_length(phones) = 1
       and phone = '207-555-0100' and notes like 'Learned from email. Details from the Worldwide portal (#99304) territory Local' as portal_filled
  from public.vendor_emails where id = :'ted';
select public.wwd_portal_contact_fill(:'v', '{"email":"ted@rr304.example","kind":"rep","title":"Other title"}', '99304') = false as second_time_nothing;

\echo '>>> the role check: order talk makes a rep, and the only rep becomes main rep'
update public.vendor_emails set roles = array['other']::public.contact_type[], contact_type = 'other' where id = :'ted';
select public.contact_role_apply(:'ted', 'rep', null, 'Emailed about placing the January order') = 'main_rep' as main_rep;
select roles = array['rep']::public.contact_type[] and role_checked_at is not null and role_note like 'Emailed about%' as is_rep from public.vendor_emails where id = :'ted';
select assigned_rep_contact_id = :'ted' as starred from public.vendors where id = :'v';

\echo '>>> shipping only: shipping, not rep; a learned rep is taken off, a WWD rep is not'
insert into public.vendor_emails (organization_id, vendor_id, email, contact_type, roles, source)
values ('00000000-0000-0000-0000-000000000001', :'v', 'ship@rr304.example', 'rep', array['rep']::public.contact_type[], 'email_enrichment') returning id as ship \gset
insert into public.vendor_emails (organization_id, vendor_id, email, contact_type, roles, source)
values ('00000000-0000-0000-0000-000000000001', :'v', 'wwd@rr304.example', 'rep', array['rep']::public.contact_type[], 'wwd_portal') returning id as wrep \gset
select public.contact_role_apply(:'ship', 'shipping', null, 'Routing and pickup') = 'changed' as ship_changed;
select roles = array['shipping']::public.contact_type[] as ship_only from public.vendor_emails where id = :'ship';
select public.contact_role_apply(:'wrep', 'shipping', null, 'Tracking') is not null as ran;
select 'rep' = any (roles) and 'shipping' = any (roles) as wwd_rep_kept from public.vendor_emails where id = :'wrep';
select assigned_rep_contact_id = :'ted' as star_unchanged from public.vendors where id = :'v';

\echo '>>> a vendor bought through a rep group: its own person is customer service, never the rep'
insert into public.rep_groups (organization_id, name) values ('00000000-0000-0000-0000-000000000001', 'RR304 Reps') returning id as g \gset
insert into public.vendors (organization_id, name, rep_group_id) values ('00000000-0000-0000-0000-000000000001', 'RR304 GROUPED', :'g') returning id as v2 \gset
insert into public.vendor_emails (organization_id, vendor_id, email, contact_type, roles, source)
values ('00000000-0000-0000-0000-000000000001', :'v2', 'cs@rr304b.example', 'other', array['other']::public.contact_type[], 'email_enrichment') returning id as cs \gset
select public.contact_role_apply(:'cs', 'rep', null, 'Order talk') is not null as ran2;
select roles = array['customer_service']::public.contact_type[] as group_vendor_cs from public.vendor_emails where id = :'cs';
select assigned_rep_contact_id is null as no_star_on_group_vendor from public.vendors where id = :'v2';

\echo '>>> the queue: only people with mail both ways'
insert into public.email_threads (organization_id, gmail_thread_id) values ('00000000-0000-0000-0000-000000000001', 'rr304') returning id as th \gset
insert into public.vendor_emails (organization_id, vendor_id, email, contact_type, roles, source)
values ('00000000-0000-0000-0000-000000000001', :'v2', 'both@rr304b.example', 'other', array['other']::public.contact_type[], 'email_enrichment'),
       ('00000000-0000-0000-0000-000000000001', :'v2', 'onlyin@rr304b.example', 'other', array['other']::public.contact_type[], 'email_enrichment');
insert into public.emails (organization_id, thread_id, gmail_id, direction, from_email, to_emails, subject, received_at, vendor_id) values
  ('00000000-0000-0000-0000-000000000001', :'th', 'rr304-1', 'in', 'both@rr304b.example', array['orders@shaverlakesports.com'], 'Price list', now() - interval '2 days', :'v2'),
  ('00000000-0000-0000-0000-000000000001', :'th', 'rr304-2', 'out', 'orders@shaverlakesports.com', array['both@rr304b.example'], 'Re: Price list - our order', now() - interval '1 day', :'v2'),
  ('00000000-0000-0000-0000-000000000001', :'th', 'rr304-3', 'in', 'onlyin@rr304b.example', array['orders@shaverlakesports.com'], 'Newsletter', now(), :'v2');
select array_agg(email order by email) = array['both@rr304b.example'] as two_way_only, max(jsonb_array_length(emails)) = 2 as with_both_emails
  from public.contact_role_queue('00000000-0000-0000-0000-000000000001', 20) where email like '%rr304b.example';

delete from public.emails where gmail_id like 'rr304-%';
delete from public.email_threads where id = :'th';
update public.vendors set assigned_rep_contact_id = null where id in (:'v', :'v2');
delete from public.vendor_emails where vendor_id in (:'v', :'v2');
delete from public.vendors where id in (:'v', :'v2');
delete from public.rep_groups where id = :'g';
