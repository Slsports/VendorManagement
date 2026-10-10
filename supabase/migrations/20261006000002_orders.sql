-- =============================================================================
-- 0013 — Orders foundation (Phase 4 data layer), fed first by Dana's Placed Order
-- Summary / Summer WWD Order Guide (2026-10-06). One row per order as the sheet
-- tracks it; line items, check-in and the pipeline come in Phase 4 proper.
-- =============================================================================
do $$ begin
  if not exists (select 1 from pg_type where typname = 'order_status') then
    create type public.order_status as enum ('open', 'awaiting_confirmation', 'confirmed', 'shipped', 'received', 'entered', 'ready_to_pay', 'paid', 'cancelled');
  end if;
  if not exists (select 1 from pg_type where typname = 'order_season') then
    create type public.order_season as enum ('summer', 'winter');
  end if;
end $$;

create table if not exists public.orders (
  id                    uuid primary key default gen_random_uuid(),
  organization_id       uuid not null references public.organizations(id) on delete cascade,
  vendor_id             uuid not null references public.vendors(id) on delete restrict,
  status                public.order_status not null default 'open',
  order_date            date,
  season                public.order_season,
  show_code             text,                       -- wwd_fall_2026 etc.; which show the order came from
  show_inferred         boolean not null default false,
  placed_by             text,                       -- as written on the sheet (DANA, D & J, JARRETT)
  placed_by_id          uuid references public.profiles(id) on delete set null,
  store_codes           text[] not null default '{}',
  billing_route         public.billing_route,
  description           text,                       -- "What was ordered?"
  est_ship_date         date,
  est_cost              numeric(12,2),
  freight_cost          numeric(12,2),
  freight_notes         text,                       -- "FREE @ $2500" and the like
  date_received         date,
  po_number             text,
  ar_due                text,                       -- as written ("NET30", "VISA 7796")
  ar_due_date           date,
  date_entered_ls       date,
  entered_by            text,
  backorder             boolean not null default false,
  shipment_notes        text,
  credits_due           boolean not null default false,
  credit_notes          text,
  date_credits_received date,
  ok_to_pay             boolean not null default false,
  notes                 text,                       -- Dana's notes
  final_cost            numeric(12,2),
  paid_date             date,
  paid_via              text check (paid_via in ('billcom', 'wwd', 'card', 'other')),
  paid_ref              text,                       -- "Paid (WWD)" column
  cost_basis            numeric(12,2),
  source                text not null default 'manual' check (source in ('manual', 'order_guide', 'placed_order_summary', 'email', 'show_scan')),
  source_key            text,                       -- stable key for re-imports of the living sheet
  source_sheet          text,
  extra                 jsonb not null default '{}'::jsonb,
  created_by            uuid references public.profiles(id) on delete set null,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);
comment on table public.orders is 'One row per order. Fed by imports of the Placed Order Summary first, then by the app.';
create unique index if not exists orders_source_key on public.orders (organization_id, source_key) where source_key is not null;
create index if not exists orders_vendor_idx on public.orders (vendor_id, order_date desc);
create index if not exists orders_status_idx on public.orders (organization_id, status);
create index if not exists orders_ship_idx on public.orders (organization_id, est_ship_date);
drop trigger if exists orders_touch on public.orders;
create trigger orders_touch before update on public.orders for each row execute function public.set_updated_at();

create table if not exists public.order_status_history (
  id          uuid primary key default gen_random_uuid(),
  order_id    uuid not null references public.orders(id) on delete cascade,
  from_status public.order_status,
  to_status   public.order_status not null,
  changed_by  uuid references public.profiles(id) on delete set null,
  changed_at  timestamptz not null default now(),
  note        text
);
create index if not exists order_status_history_order_idx on public.order_status_history (order_id, changed_at desc);

create or replace function public.log_order_status()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    insert into public.order_status_history (order_id, from_status, to_status, changed_by) values (new.id, null, new.status, auth.uid());
  elsif new.status is distinct from old.status then
    insert into public.order_status_history (order_id, from_status, to_status, changed_by) values (new.id, old.status, new.status, auth.uid());
  end if;
  return new;
end;
$$;
drop trigger if exists orders_status_log on public.orders;
create trigger orders_status_log after insert or update of status on public.orders for each row execute function public.log_order_status();

alter table public.orders enable row level security;
alter table public.order_status_history enable row level security;
drop policy if exists "orders: members read" on public.orders;
drop policy if exists "orders: editors write" on public.orders;
drop policy if exists "order_status_history: members read" on public.order_status_history;
create policy "orders: members read" on public.orders for select to authenticated using (public.user_in_org(organization_id));
create policy "orders: editors write" on public.orders for all to authenticated
  using (public.user_can_edit() and public.user_in_org(organization_id)) with check (public.user_can_edit() and public.user_in_org(organization_id));
create policy "order_status_history: members read" on public.order_status_history for select to authenticated
  using (exists (select 1 from public.orders o where o.id = order_id and public.user_in_org(o.organization_id)));
grant select, insert, update, delete on table public.orders to authenticated;
grant select on table public.order_status_history to authenticated;
grant all on table public.orders, public.order_status_history to service_role;

-- Documents on orders: invoices, confirmations, the order itself, packing slips, payment proof.
alter table public.vendor_links add column if not exists order_id uuid references public.orders(id) on delete cascade;
alter table public.vendor_links drop constraint if exists vendor_links_kind_check;
alter table public.vendor_links add constraint vendor_links_kind_check check (kind in ('catalog', 'price_list', 'order_form', 'specials', 'website', 'other', 'invoice', 'confirmation', 'order', 'packing_slip', 'payment'));
create index if not exists vendor_links_order_idx on public.vendor_links (order_id);

-- Who runs the reports and orders for this vendor, as a name until that person has a login.
alter table public.vendors add column if not exists report_owner text;
comment on column public.vendors.report_owner is 'Buyer who runs this vendor (Trevor, Jarrett, Dana). assigned_buyer_id takes over once they have logins.';

-- merge_vendors now carries orders, documents, lines and show rows across too.
create or replace function public.merge_vendors(p_keep uuid, p_remove uuid, p_route public.billing_route default null)
returns uuid
language plpgsql security definer
set search_path = ''
as $$
declare
  k public.vendors%rowtype;
  r public.vendors%rowtype;
begin
  if not public.user_can_edit() then
    raise exception 'Only editors can merge vendors' using errcode = '42501';
  end if;
  if p_keep = p_remove then
    raise exception 'Cannot merge a vendor into itself' using errcode = '22023';
  end if;
  select * into k from public.vendors where id = p_keep for update;
  select * into r from public.vendors where id = p_remove for update;
  if k.id is null or r.id is null then
    raise exception 'Vendor not found' using errcode = '23503';
  end if;
  if k.organization_id <> r.organization_id or not public.user_in_org(k.organization_id) then
    raise exception 'Vendors belong to different organizations' using errcode = '42501';
  end if;

  update public.vendors set
    aliases = (select array(select distinct x from unnest(k.aliases || r.aliases || array[r.name]::text[] || coalesce(array[r.lightspeed_name]::text[], '{}')) as x where x is not null and x <> k.name)),
    lightspeed_name = coalesce(k.lightspeed_name, r.lightspeed_name),
    lightspeed_vendor_id = coalesce(k.lightspeed_vendor_id, r.lightspeed_vendor_id),
    rep_group_id = coalesce(k.rep_group_id, r.rep_group_id),
    assigned_buyer_id = coalesce(k.assigned_buyer_id, r.assigned_buyer_id),
    payment_terms_id = coalesce(k.payment_terms_id, r.payment_terms_id),
    website = coalesce(k.website, r.website), account_number = coalesce(k.account_number, r.account_number),
    catalog = coalesce(k.catalog, r.catalog), phone = coalesce(k.phone, r.phone), fax = coalesce(k.fax, r.fax),
    address = coalesce(k.address, r.address), city = coalesce(k.city, r.city), state = coalesce(k.state, r.state),
    postal_code = coalesce(k.postal_code, r.postal_code), country = coalesce(k.country, r.country),
    rep_name = coalesce(k.rep_name, r.rep_name), rep_phone = coalesce(k.rep_phone, r.rep_phone),
    pickup_address = coalesce(k.pickup_address, r.pickup_address), pickup_times = coalesce(k.pickup_times, r.pickup_times),
    shipping_contact = coalesce(k.shipping_contact, r.shipping_contact), shipping_contact_phone = coalesce(k.shipping_contact_phone, r.shipping_contact_phone),
    return_notes = coalesce(k.return_notes, r.return_notes), google_drive_folder = coalesce(k.google_drive_folder, r.google_drive_folder),
    rating = coalesce(k.rating, r.rating), tier = coalesce(k.tier, r.tier),
    ordering_frequency = coalesce(k.ordering_frequency, r.ordering_frequency),
    is_delivery_vendor = k.is_delivery_vendor or r.is_delivery_vendor,
    minimum_order = coalesce(k.minimum_order, r.minimum_order), freight_program = coalesce(k.freight_program, r.freight_program),
    product_types = coalesce(k.product_types, r.product_types),
    notes = case when r.notes is null then k.notes when k.notes is null then r.notes else k.notes || E'\n' || r.notes end,
    do_not_order = k.do_not_order or r.do_not_order,
    do_not_order_reason = coalesce(k.do_not_order_reason, r.do_not_order_reason)
  where id = p_keep;

  insert into public.vendor_billing_routes (vendor_id, route, is_default, account_number, notes)
  select p_keep, route, false, account_number, notes from public.vendor_billing_routes where vendor_id = p_remove
  on conflict do nothing;
  update public.vendor_billing_routes set is_default = true where vendor_id = p_keep
    and not exists (select 1 from public.vendor_billing_routes where vendor_id = p_keep and is_default)
    and route = (select route from public.vendor_billing_routes where vendor_id = p_keep order by created_at limit 1);
  perform public.set_usual_route(p_keep, p_route);

  insert into public.vendor_emails (vendor_id, email, contact_name, title, phone, contact_type, source, confidence, verified_at, is_primary, notes)
  select p_keep, email, contact_name, title, phone, contact_type, source, confidence, verified_at, false, notes from public.vendor_emails where vendor_id = p_remove
  on conflict do nothing;
  insert into public.vendor_stores (vendor_id, store_id) select p_keep, store_id from public.vendor_stores where vendor_id = p_remove on conflict do nothing;
  insert into public.vendor_categories (vendor_id, category_id) select p_keep, category_id from public.vendor_categories where vendor_id = p_remove on conflict do nothing;
  update public.vendor_order_windows set vendor_id = p_keep where vendor_id = p_remove;
  update public.orders set vendor_id = p_keep where vendor_id = p_remove;
  update public.vendor_links set vendor_id = p_keep where vendor_id = p_remove;
  update public.vendor_directory set matched_vendor_id = p_keep where matched_vendor_id = p_remove;
  update public.show_appearances set vendor_id = p_keep where vendor_id = p_remove;
  update public.notes set entity_id = p_keep where entity_type = 'vendor' and entity_id = p_remove;
  update public.activity_log set entity_id = p_keep where entity_type = 'vendor' and entity_id = p_remove;

  -- Ledger: names already folded into p_remove now belong to p_keep; p_remove itself is a new row.
  update public.vendor_merges set kept_vendor_id = p_keep, kept_name = k.name, kept_lightspeed_name = coalesce(k.lightspeed_name, r.lightspeed_name),
    status = case when status = 'pending' then 'confirmed' else status end
    where kept_vendor_id = p_remove;
  insert into public.vendor_merges (organization_id, kept_vendor_id, kept_name, kept_lightspeed_name, merged_name, merged_lightspeed_name, merged_vendor_id, source, status, route, merged_by)
  values (k.organization_id, p_keep, k.name, coalesce(k.lightspeed_name, r.lightspeed_name), r.name,
          case when r.lightspeed_name is distinct from coalesce(k.lightspeed_name, r.lightspeed_name) then r.lightspeed_name end,
          p_remove, 'manual', 'confirmed', p_route, auth.uid());

  -- Duplicate review items on either side are settled by this merge.
  update public.review_items set status = 'accepted', resolved_by = auth.uid(), resolved_at = now(), resolution_note = 'Merged'
  where status = 'pending' and kind in ('vendor_duplicate', 'vendor_merge', 'vendor_marker')
    and (entity_id in (p_keep, p_remove) or (details->>'other_vendor_id')::uuid in (p_keep, p_remove));
  update public.vendor_merges set status = 'confirmed' where kept_vendor_id = p_keep and status = 'pending';

  update public.vendors set is_active = false, merged_into_id = p_keep, needs_review = false, review_note = null where id = p_remove;
  perform public.settle_vendor_review(p_keep);

  insert into public.activity_log (organization_id, entity_type, entity_id, action, details, actor_id)
  values (k.organization_id, 'vendor', p_keep, 'merged', jsonb_build_object('merged_vendor_id', p_remove, 'merged_vendor_name', r.name, 'route', p_route), auth.uid());
  return p_keep;
end;
$$;

