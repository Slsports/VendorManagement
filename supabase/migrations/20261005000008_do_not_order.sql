-- =============================================================================
-- 0011 — "Do not order" flag with a reason (Dana, 2026-10-05). A warning, not a block.
-- Also cleans vendor names that carried asterisks in Lightspeed.
-- =============================================================================
alter table public.vendors
  add column if not exists do_not_order boolean not null default false,
  add column if not exists do_not_order_reason text;

comment on column public.vendors.do_not_order is 'Warning shown everywhere the vendor appears; ordering is still possible if the buyer decides to.';

-- Puka Creations: "**PUKA CREATIONS WWD & FAIRE" in Lightspeed; the asterisks meant do-not-order.
update public.vendors
set name = 'PUKA CREATIONS',
    aliases = (select array(select distinct unnest(aliases || array[name, '**PUKA CREATIONS &']::text[]))),
    do_not_order = true,
    do_not_order_reason = 'Too many broken items on delivery; decided to stop ordering (2026).'
where organization_id = '00000000-0000-0000-0000-000000000001' and lightspeed_name ilike '%PUKA CREATIONS%';

-- American Dream Home Goods: could not deliver what was ordered, twice, with outrageous shipping.
update public.vendors
set do_not_order = true,
    do_not_order_reason = 'Ordered twice; both times they could not deliver what was ordered, shipping was outrageous, and it was too late to source elsewhere.'
where organization_id = '00000000-0000-0000-0000-000000000001' and name ilike 'AMERICAN DREAM HOME%';

-- Other names with a trailing asterisk: clean the name, keep the original as an alias, ask Dana what it meant.
with marked as (
  select id, name from public.vendors
  where organization_id = '00000000-0000-0000-0000-000000000001' and name like '%*%'
)
update public.vendors v
set name = regexp_replace(v.name, '\s*\*+\s*', '', 'g'),
    aliases = (select array(select distinct unnest(v.aliases || array[m.name]::text[])))
from marked m where m.id = v.id;

insert into public.review_items (organization_id, kind, entity_type, entity_id, title, details)
select v.organization_id, 'vendor_marker', 'vendor', v.id,
       'Lightspeed name had an asterisk: ' || v.lightspeed_name,
       jsonb_build_object('lightspeed_name', v.lightspeed_name, 'question', 'What did the asterisk mean? Mark "do not order" with a reason if that was it.')
from public.vendors v
where v.organization_id = '00000000-0000-0000-0000-000000000001'
  and v.lightspeed_name like '%*%' and not v.do_not_order
  and not exists (select 1 from public.review_items r where r.entity_id = v.id and r.kind = 'vendor_marker');

update public.vendors set needs_review = true, review_note = coalesce(review_note || E'\n', '') || 'Lightspeed name had an asterisk; see review item.'
where organization_id = '00000000-0000-0000-0000-000000000001' and lightspeed_name like '%*%' and not do_not_order;
