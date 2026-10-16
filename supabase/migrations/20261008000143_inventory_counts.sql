-- 0143 — Inventory checklists and counts (Dana, Oct 16; docs/decisions.md "Reports from Lightspeed"). A checklist is run
-- from the Sales Reports page for a vendor or category and one store, formatted by the Inventory Report spec v15 (with a
-- Vendor ID column next to Description), filed under the vendor, and printed. Employees count on paper; someone with
-- the "Enter inventory counts" tick types the totals in; someone with the "Send counts to LS" tick sends them, and VMS
-- creates an Inventory Count in Lightspeed's Inventory Counts module (never reconciles).

alter table public.profiles add column if not exists enters_counts boolean not null default false;
alter table public.profiles add column if not exists sends_counts boolean not null default false;
comment on column public.profiles.enters_counts is 'May type physical inventory counts into a checklist. Admins set it.';
comment on column public.profiles.sends_counts is 'May send a checklist''s counts to Lightspeed as an Inventory Count. Admins set it.';
update public.profiles set enters_counts = true, sends_counts = true where role = 'admin';

create or replace function public.protect_profile_privileged_columns()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  if new.organization_id is distinct from old.organization_id then
    raise exception 'A profile cannot be moved to another organization' using errcode = '42501';
  end if;
  if auth.uid() is null then
    return new;
  end if;
  if not public.is_admin() then
    if new.role      is distinct from old.role
    or new.is_active is distinct from old.is_active
    or new.email     is distinct from old.email
    or new.places_orders is distinct from old.places_orders
    or new.sees_freight is distinct from old.sees_freight
    or new.sees_accounting is distinct from old.sees_accounting
    or new.enters_counts is distinct from old.enters_counts
    or new.sends_counts is distinct from old.sends_counts then
      raise exception 'Only administrators can change role, active status, email or what a person sees' using errcode = '42501';
    end if;
  elsif new.id = auth.uid()
    and (new.role is distinct from old.role or new.is_active is distinct from old.is_active) then
    raise exception 'Administrators cannot change their own role or deactivate themselves' using errcode = '42501';
  end if;
  return new;
end;
$$;

create or replace function public.enters_counts() returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((select p.enters_counts or p.role = 'admin' from public.profiles p where p.id = auth.uid() and p.is_active), false)
$$;
revoke execute on function public.enters_counts() from public, anon;
grant execute on function public.enters_counts() to authenticated, service_role;

alter table public.vendor_links drop constraint if exists vendor_links_kind_check;
alter table public.vendor_links add constraint vendor_links_kind_check check (kind in ('catalog', 'price_list', 'order_form', 'specials', 'website', 'other',
  'invoice', 'credit', 'confirmation', 'order', 'ls_po', 'packing_slip', 'payment', 'freight_bill', 'delivery_receipt', 'image', 'approved_proof', 'damage_photo',
  'sales_report', 'proof', 'inventory_count'));

create table if not exists public.inventory_counts (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations(id) on delete cascade,
  title            text not null,
  store_code       text not null,
  shop_id          text not null,
  vendor_id        uuid references public.vendors(id) on delete set null,
  params           jsonb not null default '{}'::jsonb,
  file_name        text not null default '',
  storage_path     text,
  document_id      uuid references public.vendor_links(id) on delete set null,
  run_id           uuid references public.report_runs(id) on delete set null,
  status           text not null default 'open' check (status in ('open', 'sent')),
  ls_count_id      text,
  ls_count_name    text not null default '',
  sent_at          timestamptz,
  sent_by          uuid references public.profiles(id) on delete set null,
  sent_items       integer not null default 0,
  created_by       uuid references public.profiles(id) on delete set null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index if not exists inventory_counts_org_idx on public.inventory_counts (organization_id, created_at desc);
create index if not exists inventory_counts_vendor_idx on public.inventory_counts (vendor_id) where vendor_id is not null;
drop trigger if exists inventory_counts_updated_at on public.inventory_counts;
create trigger inventory_counts_updated_at before update on public.inventory_counts for each row execute function public.set_updated_at();

create table if not exists public.inventory_count_lines (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations(id) on delete cascade,
  count_id         uuid not null references public.inventory_counts(id) on delete cascade,
  item_id          text not null,
  system_sku       text not null default '',
  upc              text not null default '',
  vendor_name      text not null default '',
  vendor_item_id   text not null default '',
  description      text not null default '',
  category_path    text not null default '',
  in_stock         integer not null default 0,
  floor            integer,
  back_stock       integer,
  bins             integer,
  total            integer,
  entered_by       uuid references public.profiles(id) on delete set null,
  entered_at       timestamptz,
  sort_order       integer not null default 0,
  unique (count_id, item_id)
);
create index if not exists inventory_count_lines_count_idx on public.inventory_count_lines (count_id, sort_order);

grant select, insert, update, delete on public.inventory_counts, public.inventory_count_lines to authenticated;
grant all on public.inventory_counts, public.inventory_count_lines to service_role;
alter table public.inventory_counts enable row level security;
alter table public.inventory_count_lines enable row level security;
drop policy if exists "inventory_counts: members read" on public.inventory_counts;
drop policy if exists "inventory_counts: editors write" on public.inventory_counts;
create policy "inventory_counts: members read" on public.inventory_counts for select to authenticated using (public.user_in_org(organization_id));
create policy "inventory_counts: editors write" on public.inventory_counts for all to authenticated
  using (public.user_in_org(organization_id) and public.user_can_edit()) with check (public.user_in_org(organization_id) and public.user_can_edit());
drop policy if exists "inventory_count_lines: members read" on public.inventory_count_lines;
drop policy if exists "inventory_count_lines: editors insert" on public.inventory_count_lines;
drop policy if exists "inventory_count_lines: counters update" on public.inventory_count_lines;
drop policy if exists "inventory_count_lines: editors delete" on public.inventory_count_lines;
create policy "inventory_count_lines: members read" on public.inventory_count_lines for select to authenticated using (public.user_in_org(organization_id));
create policy "inventory_count_lines: editors insert" on public.inventory_count_lines for insert to authenticated
  with check (public.user_in_org(organization_id) and public.user_can_edit());
-- the counts themselves: only people with the Enter inventory counts tick (any role), and only while the checklist is open
create policy "inventory_count_lines: counters update" on public.inventory_count_lines for update to authenticated
  using (public.user_in_org(organization_id) and public.enters_counts()
         and exists (select 1 from public.inventory_counts c where c.id = inventory_count_lines.count_id and c.status = 'open'))
  with check (public.user_in_org(organization_id) and public.enters_counts());
create policy "inventory_count_lines: editors delete" on public.inventory_count_lines for delete to authenticated
  using (public.user_in_org(organization_id) and public.user_can_edit());

-- The lines of a checklist, for the count entry page and the sheet (members read; counters update through the policy).
create or replace function public.inventory_count_lines_for(p_count uuid)
returns setof public.inventory_count_lines
language sql stable security invoker set search_path = public as $$
  select * from public.inventory_count_lines where count_id = p_count order by sort_order, category_path, description
$$;
grant execute on function public.inventory_count_lines_for(uuid) to authenticated, service_role;
