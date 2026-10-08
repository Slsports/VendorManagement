-- 0039 — Order lines and retail pricing at check-in (Dana, Oct 8; docs/orders-and-mail-plan.md §3, §7).
-- Freight % = freight cost ÷ product invoice; total % = 55% margin + freight % + 1.5% for WWD upcharge
-- vendors; retail = item cost ÷ (1 − total %) (true margin: $5 at 66.5% = $14.93). VMS shows the exact
-- number; Trevor edits any price. Margin and upcharge live in organizations.settings.pricing.

create table if not exists public.order_lines (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations(id) on delete restrict,
  order_id         uuid not null references public.orders(id) on delete cascade,
  sort_order       integer not null default 0,
  vendor_item_id   text,                                   -- the vendor's item number ("Vendor ID")
  description      text,
  quantity         numeric(12,2) not null default 1,
  unit_cost        numeric(12,4) not null default 0,
  extended         numeric(14,2) generated always as (round(quantity * unit_cost, 2)) stored,
  retail_price     numeric(12,2),
  retail_edited    boolean not null default false,         -- Trevor changed it; recalculating leaves it alone
  notes            text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index if not exists order_lines_order_idx on public.order_lines (order_id, sort_order);
comment on table public.order_lines is 'Items on an order: Vendor ID, quantity, unit cost; retail price set at check-in.';

create or replace function public.order_lines_set_org()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  select organization_id into new.organization_id from public.orders where id = new.order_id;
  return new;
end;
$$;
drop trigger if exists order_lines_set_org on public.order_lines;
create trigger order_lines_set_org before insert or update of order_id on public.order_lines for each row execute function public.order_lines_set_org();
revoke execute on function public.order_lines_set_org() from public, anon, authenticated;
drop trigger if exists order_lines_set_updated_at on public.order_lines;
create trigger order_lines_set_updated_at before update on public.order_lines for each row execute function public.set_updated_at();

alter table public.order_lines enable row level security;
drop policy if exists "order_lines: members read" on public.order_lines;
drop policy if exists "order_lines: editors write" on public.order_lines;
create policy "order_lines: members read" on public.order_lines for select to authenticated using (public.user_in_org(organization_id));
create policy "order_lines: editors write" on public.order_lines for all to authenticated
  using (public.user_can_edit() and public.user_in_org(organization_id)) with check (public.user_can_edit() and public.user_in_org(organization_id));
grant select, insert, update, delete on table public.order_lines to authenticated;
grant all on table public.order_lines to service_role;

-- Dana's pricing: 55% margin, 1.5% more for WWD vendors that carry the upcharge.
update public.organizations
   set settings = jsonb_set(coalesce(settings, '{}'::jsonb), '{pricing}', '{"margin_pct": 55, "wwd_upcharge_pct": 1.5}'::jsonb, true)
 where settings->'pricing' is null;
