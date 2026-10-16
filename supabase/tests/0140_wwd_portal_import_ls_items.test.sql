\set ON_ERROR_STOP on
\pset footer off
\echo '>>> Worldwide portal: empty fields filled, typed values kept with a card, people and programs added; lines carry over'
reset role;
select set_config('request.jwt.claims', '', false) is not null as service;
insert into public.rep_groups (organization_id, name) values ('00000000-0000-0000-0000-000000000001', 'Proactive Test Sales') returning id as g \gset
insert into public.vendors (organization_id, name, phone, rep_group_id, free_shipping_policy)
values ('00000000-0000-0000-0000-000000000001', 'Crosman Test', '585-657-3000', :'g', 'sometimes') returning id as v \gset
insert into public.vendor_emails (organization_id, vendor_id, email, contact_name, source) values ('00000000-0000-0000-0000-000000000001', :'v', 'known@crosmantest.com', 'Known', 'manual');
insert into public.wwd_portal_vendors (organization_id, number, name, read_at, vendor_id, match_how, data) values ('00000000-0000-0000-0000-000000000001', 'T1', 'Crosman Test Corp', now(), :'v', 'exact', '{
  "address": {"address": "PO Box 74708", "city": "Cleveland", "state": "OH", "postal_code": "44194-4583", "phone": "800-724-7486", "fax": null},
  "standard": {"minimum_order": "$500", "billing_terms": "Net 30 Days", "freight_program": "Collect; PPD $4000", "free_shipping_policy": "sometimes", "free_shipping_threshold": 4000},
  "return_notes": "Defective goods: Call For RA. (Worldwide portal)",
  "contacts": [
    {"name": "Dan Gainor", "title": "Sales Manager", "email": "dgainor@crosmantest.com", "phones": [{"type": "work", "number": "480-460-9134"}], "company": null, "territory": "National", "kind": "rep"},
    {"name": "Harry Spotts", "title": "Sales Rep", "email": "harry@proactivetest.com", "phones": [], "company": "Proactive Test Sales and Marketing", "territory": null, "kind": "rep"},
    {"name": "Known", "title": null, "email": "KNOWN@crosmantest.com", "phones": [], "company": null, "territory": null, "kind": "other"},
    {"name": "No Email", "title": null, "email": null, "phones": [], "company": null, "territory": null, "kind": "other"}],
  "programs": [
    {"key": "standard", "name": "Standard", "kind": "standard", "freight_terms": "Collect; PPD $4000", "freight_tiers": [{"text": "PPD $4000", "kind": "prepaid", "at": 4000, "pct": null}], "minimum_order": "$500", "documents": []},
    {"key": "FAL2026", "name": "Fall Show 2026", "kind": "show", "season": "Fall", "year": 2026, "expires_on": "2026-09-30", "ship_begin": "2026-09-01", "ship_end": "2026-12-31", "freight_tiers": [], "documents": [{"name": "OW.XLSX", "description": "Order Writer"}]}]
}'::jsonb) returning id as w \gset
select public.wwd_portal_apply(:'w') as applied;
select address, city, postal_code, phone as phone_kept, minimum_order, freight_program, free_shipping_threshold, return_notes is not null as returns,
       (select name from public.payment_terms where id = payment_terms_id) as terms
  from public.vendors where id = :'v';
select kind, details->>'field' as field, details->>'ours' as ours, details->>'portal' as portal from public.review_items where entity_id = :'v' and kind = 'portal_conflict';
select email, source, contact_type, notes like 'From the Worldwide portal%' as noted from public.vendor_emails where vendor_id = :'v' order by email;
select count(*) as rep_on_group from public.rep_group_contacts where rep_group_id = :'g' and email = 'harry@proactivetest.com';
select key, name, kind, expires_on, jsonb_array_length(documents) as docs from public.vendor_programs where vendor_id = :'v' order by key;
-- a second run adds nothing twice and asks nothing twice
select public.wwd_portal_apply(:'w') as applied_again;
select count(*) as cards from public.review_items where entity_id = :'v' and kind = 'portal_conflict';
select count(*) as people from public.vendor_emails where vendor_id = :'v';
-- "Keep ours" and "Use the portal's"
set role authenticated;
select set_config('request.jwt.claims', '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}', false) is not null as admin_in;
select public.resolve_portal_conflict(id, true) from public.review_items where entity_id = :'v' and kind = 'portal_conflict';
reset role;
select set_config('request.jwt.claims', '', false) is not null as service;
select phone as phone_now_portal, (select status from public.review_items where entity_id = :'v' and kind = 'portal_conflict') as card from public.vendors where id = :'v';

\echo '>>> A portal line tied to a vendor later gets the portal details'
insert into public.vendors (organization_id, name) values ('00000000-0000-0000-0000-000000000001', 'Tara Test Toys') returning id as v2 \gset
insert into public.vendor_directory (organization_id, source, name) values ('00000000-0000-0000-0000-000000000001', 'wwd_portal', 'Tara Test Toy Corp') returning id as l \gset
insert into public.wwd_portal_vendors (organization_id, number, name, read_at, line_id, data) values ('00000000-0000-0000-0000-000000000001', 'T2', 'Tara Test Toy Corp', now(), :'l',
  '{"address": {"city": "Toyville", "phone": "800-555-0100"}, "standard": {}, "contacts": [{"name": "Tara", "email": "tara@taratest.com", "phones": [], "kind": "rep"}], "programs": []}'::jsonb) returning id as w2 \gset
update public.vendor_directory set matched_vendor_id = :'v2' where id = :'l';
select city, phone from public.vendors where id = :'v2';
select match_how, applied_at is not null as applied from public.wwd_portal_vendors where id = :'w2';
select count(*) as tara_contact from public.vendor_emails where vendor_id = :'v2' and email = 'tara@taratest.com';

\echo '>>> Lightspeed items: active / inactive / none from the reading, and a re-tie shows the new counts'
insert into public.ls_vendors (organization_id, ls_vendor_id, name) values ('00000000-0000-0000-0000-000000000001', 'T901', 'CROSMAN TEST'), ('00000000-0000-0000-0000-000000000001', 'T902', 'TARA TEST'), ('00000000-0000-0000-0000-000000000001', 'T903', 'EMPTY TEST')
  on conflict do nothing;
update public.vendors set lightspeed_vendor_id = 'T901' where id = :'v';
update public.vendors set lightspeed_vendor_id = 'T902' where id = :'v2';
insert into public.ls_item_scans (organization_id, finished_at, counts) values ('00000000-0000-0000-0000-000000000001', now(), '{"T901": [12, 3], "T902": [0, 40]}')
  on conflict (organization_id) do update set finished_at = excluded.finished_at, counts = excluded.counts;
select public.ls_items_apply('00000000-0000-0000-0000-000000000001') >= 2 as applied;
select name, ls_active_items, ls_archived_items, ls_status from public.vendors where id in (:'v', :'v2') order by name;
update public.vendors set lightspeed_vendor_id = 'T903' where id = :'v2';
select ls_active_items, ls_archived_items, ls_status as now_none from public.vendors where id = :'v2';
update public.vendors set lightspeed_vendor_id = null where id = :'v2';
select ls_status is null as untied_no_label from public.vendors where id = :'v2';

-- clean up
delete from public.review_items where entity_id in (:'v', :'v2');
delete from public.wwd_portal_vendors where id in (:'w', :'w2');
delete from public.vendor_directory where id = :'l';
delete from public.vendor_programs where vendor_id in (:'v', :'v2');
delete from public.vendor_emails where vendor_id in (:'v', :'v2');
delete from public.rep_group_contacts where rep_group_id = :'g';
update public.vendors set lightspeed_vendor_id = null where id in (:'v', :'v2');
delete from public.vendors where id in (:'v', :'v2');
delete from public.rep_groups where id = :'g';
delete from public.ls_vendors where ls_vendor_id in ('T901', 'T902', 'T903');
delete from public.ls_item_scans;
