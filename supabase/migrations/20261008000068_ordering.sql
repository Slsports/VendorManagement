-- 0089 — Ordering (Dana, Oct 11–12): one dashboard card that follows a vendor from "do we need anything?" to the
-- confirmed order. Two flags start it — "Check if we need it" (check stock) and "Remind me to order" (to order). A
-- check is answered from the vendor's LS sales report: Claude formats the raw LS Analytics export (spec v49), files it
-- in Sales reports and works out a suggested order = what LS says we need minus what is already coming in. "Order it"
-- moves the vendor to To order; "Order placed" opens the order form filled in from the suggestion and closes the flag.
-- Placed, Confirmed and Overdue come from the orders themselves. The LS PO is made after the confirmation: a confirmed
-- order with no LS PO number and no LS PO document shows "LS PO needed".
create table if not exists public.ordering_items (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  vendor_id       uuid not null references public.vendors(id) on delete cascade,
  stage           text not null check (stage in ('check', 'to_order', 'done')),
  note            text,
  assigned_to     uuid references public.profiles(id) on delete set null,
  flagged_by      uuid references public.profiles(id) on delete set null,
  thread_id       uuid references public.email_threads(id) on delete set null,
  report_id       uuid,
  outcome         text check (outcome in ('ordered', 'not_needed', 'removed')),
  order_id        uuid references public.orders(id) on delete set null,
  done_at         timestamptz,
  done_by         uuid references public.profiles(id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  check ((stage = 'done') = (outcome is not null))
);
-- one open flag per vendor
create unique index if not exists ordering_items_open_vendor on public.ordering_items (vendor_id) where stage <> 'done';
create index if not exists ordering_items_stage_idx on public.ordering_items (organization_id, stage) where stage <> 'done';
drop trigger if exists ordering_items_updated_at on public.ordering_items;
create trigger ordering_items_updated_at before update on public.ordering_items for each row execute function public.set_updated_at();

-- A vendor's LS sales report as VMS read it: the items (Vendor ID, sold, in stock, need …) for the suggested order.
create table if not exists public.sales_reports (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  vendor_id       uuid not null references public.vendors(id) on delete cascade,
  document_id     uuid references public.vendor_links(id) on delete set null,
  ls_vendor       text,
  run_date        date not null default current_date,
  days            integer not null default 365,
  items           jsonb not null default '[]'::jsonb,
  summary         jsonb not null default '{}'::jsonb,
  created_by      uuid references public.profiles(id) on delete set null,
  created_at      timestamptz not null default now()
);
create index if not exists sales_reports_vendor_idx on public.sales_reports (vendor_id, created_at desc);
alter table public.ordering_items drop constraint if exists ordering_items_report_id_fkey;
alter table public.ordering_items add constraint ordering_items_report_id_fkey foreign key (report_id) references public.sales_reports(id) on delete set null;

-- The LS PO number, typed in once the PO is made in LS (after the confirmation).
alter table public.orders add column if not exists ls_po_number text;

-- Flagging and settling go through the editors; who flagged and when is kept.
create or replace function public.ordering_items_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    new.flagged_by := coalesce(auth.uid(), new.flagged_by);
  end if;
  if new.stage = 'done' and (tg_op = 'INSERT' or old.stage <> 'done') then
    new.done_at := now();
    new.done_by := coalesce(auth.uid(), new.done_by);
  end if;
  if not exists (select 1 from public.vendors v where v.id = new.vendor_id and v.organization_id = new.organization_id) then
    raise exception 'Vendor not found' using errcode = '23503';
  end if;
  return new;
end;
$$;
drop trigger if exists ordering_items_guard on public.ordering_items;
create trigger ordering_items_guard before insert or update on public.ordering_items for each row execute function public.ordering_items_guard();

alter table public.ordering_items enable row level security;
drop policy if exists "ordering_items: members read" on public.ordering_items;
create policy "ordering_items: members read" on public.ordering_items for select to authenticated using (public.user_in_org(organization_id));
drop policy if exists "ordering_items: editors write" on public.ordering_items;
create policy "ordering_items: editors write" on public.ordering_items for all to authenticated
  using (public.user_in_org(organization_id) and public.user_can_edit())
  with check (public.user_in_org(organization_id) and public.user_can_edit());
grant select, insert, update, delete on table public.ordering_items to authenticated;
grant all on table public.ordering_items to service_role;

alter table public.sales_reports enable row level security;
drop policy if exists "sales_reports: members read" on public.sales_reports;
create policy "sales_reports: members read" on public.sales_reports for select to authenticated using (public.user_in_org(organization_id));
drop policy if exists "sales_reports: editors write" on public.sales_reports;
create policy "sales_reports: editors write" on public.sales_reports for all to authenticated
  using (public.user_in_org(organization_id) and public.user_can_edit())
  with check (public.user_in_org(organization_id) and public.user_can_edit());
grant select, insert, update, delete on table public.sales_reports to authenticated;
grant all on table public.sales_reports to service_role;
