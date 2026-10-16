-- 0141 — Sales Reports from Lightspeed (Dana, Oct 16; docs/decisions.md "Reports from Lightspeed, replacing LS
-- Analytics"). The ls-sync function copies LS's items (with stock per shop), sales and sale lines into these tables, a
-- slice a minute; the Sales Reports page reads them (no exports, no 24-hour lag) and formats vendor and category
-- reports by spec v49. Filed runs and saved settings live in report_runs and report_presets.

create table if not exists public.ls_items (
  organization_id    uuid not null references public.organizations(id) on delete cascade,
  item_id            text not null,
  system_sku         text not null default '',
  upc                text not null default '',
  custom_sku         text not null default '',
  manufacturer_sku   text not null default '',
  vendor_item_id     text not null default '',      -- LS "Vendor ID" (ItemVendorNums) for the default vendor
  description        text not null default '',
  default_cost       numeric(12, 2),
  category_id        text not null default '',
  category_path      text not null default '',      -- "FOOTWEAR/HIKING/MENS"
  default_vendor_id  text not null default '',      -- LS vendorID; '' when none
  archived           boolean not null default false,
  item_type          text not null default 'default',
  matrix_id          text not null default '',
  qoh                jsonb not null default '{}'::jsonb,  -- {"1": 3, "2": 0, "3": 5} on hand per shopID; "0" is LS's total
  ls_updated_at      timestamptz,
  synced_at          timestamptz not null default now(),
  primary key (organization_id, item_id)
);
create index if not exists ls_items_vendor_idx on public.ls_items (organization_id, default_vendor_id);
create index if not exists ls_items_category_idx on public.ls_items (organization_id, category_path text_pattern_ops);
create index if not exists ls_items_system_sku_idx on public.ls_items (organization_id, system_sku);

create table if not exists public.ls_sales (
  organization_id  uuid not null references public.organizations(id) on delete cascade,
  sale_id          text not null,
  shop_id          text not null default '',
  completed        boolean not null default false,
  voided           boolean not null default false,
  sold_at          timestamptz,
  ls_updated_at    timestamptz,
  primary key (organization_id, sale_id)
);

create table if not exists public.ls_sale_lines (
  organization_id  uuid not null references public.organizations(id) on delete cascade,
  sale_line_id     text not null,
  sale_id          text not null,
  item_id          text not null,
  shop_id          text not null default '',
  qty              numeric(12, 3) not null default 0,   -- unitQuantity; negative on a return
  sold_at          timestamptz not null,
  ls_updated_at    timestamptz,
  primary key (organization_id, sale_line_id)
);
create index if not exists ls_sale_lines_item_idx on public.ls_sale_lines (organization_id, item_id, sold_at);
create index if not exists ls_sale_lines_sold_idx on public.ls_sale_lines (organization_id, sold_at);

-- Where each pass stands: a cursor (LS's "next" link) while a pass runs, "since" for the next incremental pass.
create table if not exists public.ls_sync (
  organization_id      uuid primary key references public.organizations(id) on delete cascade,
  items_cursor         text,
  items_pass_started   timestamptz,
  items_pass_finished  timestamptz,
  items_seen           integer not null default 0,
  sales_cursor         text,
  sales_since          timestamptz,
  sales_backfill_done  boolean not null default false,
  lines_cursor         text,
  lines_since          timestamptz,
  lines_backfill_done  boolean not null default false,
  lines_seen           integer not null default 0,
  backfill_from        timestamptz not null default (now() - interval '24 months'),
  last_error           text,
  lock_until           timestamptz,
  updated_at           timestamptz not null default now()
);

create table if not exists public.report_runs (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations(id) on delete cascade,
  kind             text not null check (kind in ('vendor', 'category', 'inventory')),
  title            text not null,
  params           jsonb not null default '{}'::jsonb,   -- vendor_ids, categories, store_codes, store_mode, from, to, days
  file_name        text not null default '',
  storage_path     text,                                   -- vendor-files/<org>/reports/… for category runs
  document_id      uuid references public.vendor_links(id) on delete set null,   -- vendor runs: the file in the vendor's folder
  sales_report_id  uuid references public.sales_reports(id) on delete set null,  -- vendor runs: the suggested order's items
  summary          jsonb not null default '{}'::jsonb,
  created_by       uuid references public.profiles(id) on delete set null,
  created_at       timestamptz not null default now()
);
create index if not exists report_runs_org_idx on public.report_runs (organization_id, created_at desc);

create table if not exists public.report_presets (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations(id) on delete cascade,
  name             text not null check (length(trim(name)) > 0),
  kind             text not null check (kind in ('vendor', 'category', 'inventory')),
  params           jsonb not null default '{}'::jsonb,
  created_by       uuid references public.profiles(id) on delete set null,
  created_at       timestamptz not null default now(),
  unique (organization_id, name)
);

-- ---- grants and RLS ------------------------------------------------------------------------------------------------
grant select on public.ls_items, public.ls_sales, public.ls_sale_lines, public.ls_sync to authenticated;
grant all on public.ls_items, public.ls_sales, public.ls_sale_lines, public.ls_sync to service_role;
grant select, insert, update, delete on public.report_runs, public.report_presets to authenticated;
grant all on public.report_runs, public.report_presets to service_role;
alter table public.ls_items enable row level security;
alter table public.ls_sales enable row level security;
alter table public.ls_sale_lines enable row level security;
alter table public.ls_sync enable row level security;
alter table public.report_runs enable row level security;
alter table public.report_presets enable row level security;
drop policy if exists "ls_items: members read" on public.ls_items;
create policy "ls_items: members read" on public.ls_items for select to authenticated using (public.user_in_org(organization_id));
drop policy if exists "ls_sales: members read" on public.ls_sales;
create policy "ls_sales: members read" on public.ls_sales for select to authenticated using (public.user_in_org(organization_id));
drop policy if exists "ls_sale_lines: members read" on public.ls_sale_lines;
create policy "ls_sale_lines: members read" on public.ls_sale_lines for select to authenticated using (public.user_in_org(organization_id));
drop policy if exists "ls_sync: members read" on public.ls_sync;
create policy "ls_sync: members read" on public.ls_sync for select to authenticated using (public.user_in_org(organization_id));
drop policy if exists "report_runs: members read" on public.report_runs;
drop policy if exists "report_runs: editors write" on public.report_runs;
create policy "report_runs: members read" on public.report_runs for select to authenticated using (public.user_in_org(organization_id));
create policy "report_runs: editors write" on public.report_runs for all to authenticated
  using (public.user_in_org(organization_id) and public.user_can_edit()) with check (public.user_in_org(organization_id) and public.user_can_edit());
drop policy if exists "report_presets: members read" on public.report_presets;
drop policy if exists "report_presets: editors write" on public.report_presets;
create policy "report_presets: members read" on public.report_presets for select to authenticated using (public.user_in_org(organization_id));
create policy "report_presets: editors write" on public.report_presets for all to authenticated
  using (public.user_in_org(organization_id) and public.user_can_edit()) with check (public.user_in_org(organization_id) and public.user_can_edit());

-- ---- the report's rows ---------------------------------------------------------------------------------------------
-- Every LS item of the chosen vendors and/or categories (archived included: the page partitions them by the spec), with
-- stock per shop and units sold per shop in the period (completed, not voided sales; returns count against sales).
create or replace function public.ls_report_rows(
  p_org uuid, p_from date, p_to date, p_shops text[], p_vendor_ids text[] default null, p_category_prefixes text[] default null)
returns table (
  item_id text, system_sku text, upc text, vendor_item_id text, custom_sku text, manufacturer_sku text, description text,
  default_cost numeric, category_path text, default_vendor_id text, vendor_name text, archived boolean, item_type text,
  qoh jsonb, sold jsonb, sold_total numeric, last_sold date)
language sql stable security invoker set search_path = public as $$
  with items as (
    select i.* from public.ls_items i
     where i.organization_id = p_org
       and (p_vendor_ids is null or i.default_vendor_id = any (p_vendor_ids))
       and (p_category_prefixes is null or exists (select 1 from unnest(p_category_prefixes) c where i.category_path = c or i.category_path like c || '/%'))
  ),
  sales as (
    select l.item_id, l.shop_id, sum(l.qty) as qty, max(l.sold_at) as last_at
      from public.ls_sale_lines l
      join items i on i.item_id = l.item_id
      left join public.ls_sales s on s.organization_id = l.organization_id and s.sale_id = l.sale_id
     where l.organization_id = p_org and l.shop_id = any (p_shops)
       and l.sold_at >= p_from::timestamptz and l.sold_at < (p_to + 1)::timestamptz
       and (s.sale_id is null or (s.completed and not s.voided))
     group by l.item_id, l.shop_id
  ),
  per_item as (
    select item_id, jsonb_object_agg(shop_id, qty) as sold, sum(qty) as total, max(last_at) as last_at from sales group by item_id
  )
  select i.item_id, i.system_sku, i.upc, i.vendor_item_id, i.custom_sku, i.manufacturer_sku, i.description, i.default_cost,
         i.category_path, i.default_vendor_id, coalesce(v.name, ''), i.archived, i.item_type,
         i.qoh, coalesce(p.sold, '{}'::jsonb), coalesce(p.total, 0),
         (select max(l.sold_at)::date from public.ls_sale_lines l
            left join public.ls_sales s on s.organization_id = l.organization_id and s.sale_id = l.sale_id
           where l.organization_id = p_org and l.item_id = i.item_id and l.shop_id = any (p_shops) and l.qty > 0
             and (s.sale_id is null or (s.completed and not s.voided))) as last_sold
    from items i
    left join public.ls_vendors v on v.organization_id = i.organization_id and v.ls_vendor_id = i.default_vendor_id
    left join per_item p on p.item_id = i.item_id
$$;
revoke execute on function public.ls_report_rows(uuid, date, date, text[], text[], text[]) from public, anon;
grant execute on function public.ls_report_rows(uuid, date, date, text[], text[], text[]) to authenticated, service_role;

-- The category tree for the picker: every path with its item count.
create or replace function public.ls_categories(p_org uuid)
returns table (category_path text, items bigint)
language sql stable security invoker set search_path = public as $$
  select i.category_path, count(*) from public.ls_items i
   where i.organization_id = p_org and i.category_path <> '' and not i.archived
   group by i.category_path order by i.category_path
$$;
revoke execute on function public.ls_categories(uuid) from public, anon;
grant execute on function public.ls_categories(uuid) to authenticated, service_role;
