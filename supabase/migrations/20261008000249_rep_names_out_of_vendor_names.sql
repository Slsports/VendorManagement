-- 0249 — Donna's name out of three vendor names (Dana, Oct 27): "Why did vms leave the Donna Hoffman on the name of this
-- Vendor: Extended Exposure … I don't want clean up cards LOL, just change them." The Oct 6 clean-up only caught a rep's
-- name after " - " (spaces) or "(", so EXTENDED EXPOSURE-DONNA HOFFMAN, KURT S. ADLER-DONNA and OEELINN DONNA DIVERSE
-- MARKETING kept it. Renamed; the old name stays an alias and the Lightspeed name is unchanged, so sales reports and POs
-- still match. Oeelinn goes under DandyLines / Diverse Marketing (Donna's group). Nothing changes in Lightspeed.

set local lock_timeout = '5s';

with ren (id, new_name) as (values
  ('a1861516-b9d4-485a-84fe-277a14417b2f'::uuid, 'EXTENDED EXPOSURE'),
  ('7091579a-faf3-4f83-b649-3b4e836ea911'::uuid, 'KURT S. ADLER'),
  ('47f42982-1236-49ed-83e5-5b17594b1a1f'::uuid, 'OEELINN')),
old as (
  select r.id, r.new_name, v.name as old_name from ren r join public.vendors v on v.id = r.id
   where v.name <> r.new_name
     and not exists (select 1 from public.vendors o where o.organization_id = v.organization_id and lower(o.name) = lower(r.new_name) and o.id <> v.id)),
upd as (
  update public.vendors v set
    name = o.new_name,
    aliases = (select array(select distinct x from unnest(v.aliases || array[o.old_name]) x where x is not null and x <> o.new_name)),
    rep_group_id = coalesce(v.rep_group_id, (select g.id from public.rep_groups g where g.organization_id = v.organization_id and g.name = 'DandyLines / Diverse Marketing' limit 1))
  from old o
  where v.id = o.id
  returning v.id, v.organization_id, v.rep_group_id, o.new_name, o.old_name)
insert into public.activity_log (organization_id, entity_type, entity_id, action, details)
select u.organization_id, 'vendor', u.id, 'renamed',
       jsonb_build_object('from', u.old_name, 'to', u.new_name, 'rep_group_id', u.rep_group_id, 'note', 'Rep''s name taken out of the vendor name (Dana, Oct 27)')
  from upd u;
