-- 0021 — Item-level buying rules per vendor (Dana, 2026-10-07): "I will want tags that tell us if we
-- are to stop ordering certain items from that vendor vs not ordering anything from them."
-- The vendor's standing says whether to order from them at all; these rules say what. A rule is on a
-- product type (Ty "Squish": stop) or on one item by Vendor ID (83030 Bouncer Black Panther: stop).
-- Seeded from Dana's Ty analysis; the Lightspeed connection will tie item rules to real items and
-- let sell-through propose new ones.

create table if not exists public.vendor_item_rules (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations(id) on delete restrict,
  vendor_id        uuid not null references public.vendors(id) on delete cascade,
  scope            text not null check (scope in ('type', 'item')),
  vendor_item_id   text,                                  -- the vendor's item number, for scope = item
  name             text not null,                         -- product type, or the item's name
  rule             text not null check (rule in ('stop', 'keep', 'reorder_first', 'watch')),
  reason           text,
  source           text,                                  -- where the rule came from, e.g. "Ty analysis v3, Oct 6 2026"
  as_of            date,
  created_by       uuid references public.profiles(id) on delete set null,
  created_at       timestamptz not null default now(),
  constraint vendor_item_rules_item_id_check check (scope = 'type' or nullif(trim(vendor_item_id), '') is not null)
);
comment on table public.vendor_item_rules is 'What to order from a vendor: stop / keep / reorder first / watch, per product type or per item (Vendor ID).';
create unique index if not exists vendor_item_rules_type_key on public.vendor_item_rules (vendor_id, upper(name)) where scope = 'type';
create unique index if not exists vendor_item_rules_item_key on public.vendor_item_rules (vendor_id, vendor_item_id) where scope = 'item';
create index if not exists vendor_item_rules_vendor_idx on public.vendor_item_rules (vendor_id, scope, rule);

alter table public.vendor_item_rules enable row level security;
drop policy if exists "vendor_item_rules: members read" on public.vendor_item_rules;
drop policy if exists "vendor_item_rules: editors write" on public.vendor_item_rules;
create policy "vendor_item_rules: members read" on public.vendor_item_rules for select to authenticated using (public.user_in_org(organization_id));
create policy "vendor_item_rules: editors write" on public.vendor_item_rules for all to authenticated
  using (public.user_can_edit() and public.user_in_org(organization_id)) with check (public.user_can_edit() and public.user_in_org(organization_id));
grant select, insert, update, delete on table public.vendor_item_rules to authenticated;
grant all on table public.vendor_item_rules to service_role;
