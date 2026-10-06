-- 0018 — Vendor scoring (Dana, 2026-10-07): "an automated scoring system based on ease of ordering,
-- rep/vendor communication & willingness to help, fulfilment on time or not, shipping issues and how
-- well they resolve issues." Plus, from Dana the same morning: damaged goods and mistakes on orders
-- (quantities, wrong item). Four of the six score themselves from the order history (fulfilment,
-- accuracy, shipping, resolution); staff rate any dimension by hand and the hand rating wins. Ease
-- and communication wait for the Gmail connection; after a full year in VMS the check-in form and
-- the vendor emails feed every dimension.

create table if not exists public.vendor_ratings (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations(id) on delete restrict,
  vendor_id        uuid not null references public.vendors(id) on delete cascade,
  dimension        text not null check (dimension in ('ease', 'communication', 'fulfilment', 'accuracy', 'shipping', 'resolution')),
  score            smallint not null check (score between 1 and 5),
  note             text,
  rated_by         uuid references public.profiles(id) on delete set null,
  rated_at         timestamptz not null default now()
);
comment on table public.vendor_ratings is 'Hand ratings, 1 to 5, one row per rating; the latest per vendor and dimension counts. History is kept.';
create index if not exists vendor_ratings_latest_idx on public.vendor_ratings (vendor_id, dimension, rated_at desc);

alter table public.vendor_ratings enable row level security;
drop policy if exists "vendor_ratings: members read" on public.vendor_ratings;
drop policy if exists "vendor_ratings: editors insert" on public.vendor_ratings;
drop policy if exists "vendor_ratings: admins delete" on public.vendor_ratings;
create policy "vendor_ratings: members read" on public.vendor_ratings for select to authenticated using (public.user_in_org(organization_id));
create policy "vendor_ratings: editors insert" on public.vendor_ratings for insert to authenticated with check (public.user_can_edit() and public.user_in_org(organization_id));
create policy "vendor_ratings: admins delete" on public.vendor_ratings for delete to authenticated using (public.is_admin() and public.user_in_org(organization_id));
grant select, insert, delete on table public.vendor_ratings to authenticated;
grant all on table public.vendor_ratings to service_role;

-- One row per active vendor (or the one asked for): the signals from the order history, the automatic
-- scores they produce, the latest hand ratings, and the overall (hand rating wins over automatic).
create or replace function public.vendor_scorecards(p_org uuid, p_vendor uuid default null)
returns table (
  vendor_id uuid, name text,
  orders integer, received integer, on_time integer, late integer, avg_days_late numeric,
  freight_pct numeric, freight_orders integer, free_violations integer, issue_notes integer, accuracy_issues integer,
  credits_due integer, credits_resolved integer, avg_credit_days numeric,
  auto_fulfilment integer, auto_accuracy integer, auto_shipping integer, auto_resolution integer,
  rated_ease integer, rated_communication integer, rated_fulfilment integer, rated_accuracy integer, rated_shipping integer, rated_resolution integer,
  note_ease text, note_communication text, note_fulfilment text, note_accuracy text, note_shipping text, note_resolution text,
  overall numeric
)
language sql stable
set search_path = public
as $$
with o as (
  select o.vendor_id,
    count(*)::integer as orders,
    count(*) filter (where o.date_received is not null and o.est_ship_date is not null)::integer as received,
    count(*) filter (where o.date_received is not null and o.est_ship_date is not null and o.date_received <= o.est_ship_date + 7)::integer as on_time,
    count(*) filter (where o.date_received is not null and o.est_ship_date is not null and o.date_received > o.est_ship_date + 7)::integer as late,
    round(avg(o.date_received - o.est_ship_date) filter (where o.date_received is not null and o.est_ship_date is not null and o.date_received > o.est_ship_date + 7), 0) as avg_days_late,
    sum(o.freight_cost) filter (where o.freight_cost is not null and coalesce(o.final_cost, o.est_cost) > 0) as freight_known,
    sum(coalesce(o.final_cost, o.est_cost)) filter (where o.freight_cost is not null and coalesce(o.final_cost, o.est_cost) > 0) as product_known,
    count(*) filter (where o.freight_cost is not null and coalesce(o.final_cost, o.est_cost) > 0)::integer as freight_orders,
    count(*) filter (where o.freight_cost > 0 and (o.free_shipping or v.free_shipping_policy = 'always'
      or (v.free_shipping_policy = 'sometimes' and v.free_shipping_threshold is not null and coalesce(o.final_cost, o.est_cost) >= v.free_shipping_threshold)))::integer as free_violations,
    count(*) filter (where concat_ws(' ', o.shipment_notes, o.credit_notes, o.freight_notes, o.notes)
      ~* '(\mlate\M|delay|backorder|\mb/o\M|cancel|\mlost\M|never (arrived|received|shipped)|refus|no (response|answer)|did ?n.t (respond|reply|ship)|ignored|double.?(bill|charg)|overcharg|dispute)')::integer as issue_notes,
    count(*) filter (where concat_ws(' ', o.shipment_notes, o.credit_notes, o.notes)
      ~* '(damag|broken|crush|short(ed|age| ship)|missing|wrong|incorrect|mistake|\merror|double.?ship|wrong (item|qty|quantity|size|color))')::integer as accuracy_issues,
    count(*) filter (where o.credits_due)::integer as credits_due,
    count(*) filter (where o.credits_due and o.date_credits_received is not null)::integer as credits_resolved,
    round(avg(o.date_credits_received - coalesce(o.date_received, o.order_date)) filter (where o.credits_due and o.date_credits_received is not null), 0) as avg_credit_days
  from public.orders o join public.vendors v on v.id = o.vendor_id
  where o.organization_id = p_org and (p_vendor is null or o.vendor_id = p_vendor)
  group by o.vendor_id
), r as (
  select distinct on (vendor_id, dimension) vendor_id, dimension, score, note
  from public.vendor_ratings
  where organization_id = p_org and (p_vendor is null or vendor_id = p_vendor)
  order by vendor_id, dimension, rated_at desc
), rp as (
  select vendor_id,
    max(score) filter (where dimension = 'ease')::integer as rated_ease,
    max(score) filter (where dimension = 'communication')::integer as rated_communication,
    max(score) filter (where dimension = 'fulfilment')::integer as rated_fulfilment,
    max(score) filter (where dimension = 'accuracy')::integer as rated_accuracy,
    max(score) filter (where dimension = 'shipping')::integer as rated_shipping,
    max(score) filter (where dimension = 'resolution')::integer as rated_resolution,
    max(note) filter (where dimension = 'ease') as note_ease,
    max(note) filter (where dimension = 'communication') as note_communication,
    max(note) filter (where dimension = 'fulfilment') as note_fulfilment,
    max(note) filter (where dimension = 'accuracy') as note_accuracy,
    max(note) filter (where dimension = 'shipping') as note_shipping,
    max(note) filter (where dimension = 'resolution') as note_resolution
  from r group by vendor_id
), base as (
  select v.id as vendor_id, v.name,
    coalesce(o.orders, 0) as orders, coalesce(o.received, 0) as received, coalesce(o.on_time, 0) as on_time, coalesce(o.late, 0) as late, o.avg_days_late,
    case when coalesce(o.freight_orders, 0) >= 2 and o.product_known > 0 then round(100 * coalesce(o.freight_known, 0) / o.product_known, 1) end as freight_pct,
    coalesce(o.freight_orders, 0) as freight_orders, coalesce(o.free_violations, 0) as free_violations, coalesce(o.issue_notes, 0) as issue_notes, coalesce(o.accuracy_issues, 0) as accuracy_issues,
    coalesce(o.credits_due, 0) as credits_due, coalesce(o.credits_resolved, 0) as credits_resolved, o.avg_credit_days,
    rp.rated_ease, rp.rated_communication, rp.rated_fulfilment, rp.rated_accuracy, rp.rated_shipping, rp.rated_resolution,
    rp.note_ease, rp.note_communication, rp.note_fulfilment, rp.note_accuracy, rp.note_shipping, rp.note_resolution
  from public.vendors v
  left join o on o.vendor_id = v.id
  left join rp on rp.vendor_id = v.id
  where v.organization_id = p_org and v.is_active and (p_vendor is null or v.id = p_vendor)
), scored as (
  select b.*,
    case when b.received >= 2 then
      case when b.on_time::numeric / b.received >= 0.9 then 5 when b.on_time::numeric / b.received >= 0.75 then 4
           when b.on_time::numeric / b.received >= 0.6 then 3 when b.on_time::numeric / b.received >= 0.4 then 2 else 1 end end as auto_fulfilment,
    case when b.orders >= 3 then
      case when b.accuracy_issues = 0 then 5 when b.accuracy_issues::numeric / b.orders <= 0.10 then 4
           when b.accuracy_issues::numeric / b.orders <= 0.25 then 3 when b.accuracy_issues::numeric / b.orders <= 0.50 then 2 else 1 end end as auto_accuracy,
    case when b.freight_pct is not null then greatest(1,
      (case when b.freight_pct <= 5 then 5 when b.freight_pct <= 10 then 4 when b.freight_pct <= 20 then 3 when b.freight_pct <= 35 then 2 else 1 end)
      - (b.free_violations > 0)::integer - (b.issue_notes >= 3)::integer) end as auto_shipping,
    case when b.credits_due > 0 then
      case when b.credits_resolved = b.credits_due and coalesce(b.avg_credit_days, 0) <= 30 then 5
           when b.credits_resolved = b.credits_due then 4
           when b.credits_resolved::numeric / b.credits_due >= 0.5 then 3
           when b.credits_resolved > 0 then 2 else 1 end end as auto_resolution
  from base b
)
select s.vendor_id, s.name, s.orders, s.received, s.on_time, s.late, s.avg_days_late,
  s.freight_pct, s.freight_orders, s.free_violations, s.issue_notes, s.accuracy_issues,
  s.credits_due, s.credits_resolved, s.avg_credit_days,
  s.auto_fulfilment, s.auto_accuracy, s.auto_shipping, s.auto_resolution,
  s.rated_ease, s.rated_communication, s.rated_fulfilment, s.rated_accuracy, s.rated_shipping, s.rated_resolution,
  s.note_ease, s.note_communication, s.note_fulfilment, s.note_accuracy, s.note_shipping, s.note_resolution,
  (select round(avg(x), 1) from unnest(array[
      s.rated_ease::numeric, s.rated_communication::numeric,
      coalesce(s.rated_fulfilment, s.auto_fulfilment)::numeric,
      coalesce(s.rated_accuracy, s.auto_accuracy)::numeric,
      coalesce(s.rated_shipping, s.auto_shipping)::numeric,
      coalesce(s.rated_resolution, s.auto_resolution)::numeric]) as x) as overall
from scored s
order by s.name
$$;
comment on function public.vendor_scorecards(uuid, uuid) is 'Vendor scorecards: order-history signals, automatic scores (fulfilment, accuracy, shipping, resolution), latest hand ratings, overall. Hand rating wins.';
grant execute on function public.vendor_scorecards(uuid, uuid) to authenticated, service_role;
