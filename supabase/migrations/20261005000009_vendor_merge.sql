-- =============================================================================
-- 0009 — Duplicate review: merge / split / confirm with route choice, and the
-- Lightspeed merge ledger (Dana, 2026-10-05: "I need to be able to tell you if
-- it's WWD or Faire or not", "provide a report of what got merged into what").
-- =============================================================================
alter table public.vendors add column if not exists merged_into_id uuid references public.vendors(id) on delete set null;
comment on column public.vendors.merged_into_id is 'Set when this vendor was merged into another; the row stays (inactive) for history.';

-- ---------------------------------------------------------------------------
-- Ledger: one row per Lightspeed vendor name folded into another vendor.
-- Dana works this list in Lightspeed and ticks "done in LS" as she goes.
-- ---------------------------------------------------------------------------
create table if not exists public.vendor_merges (
  id                     uuid primary key default gen_random_uuid(),
  organization_id        uuid not null references public.organizations(id) on delete cascade,
  kept_vendor_id         uuid not null references public.vendors(id) on delete cascade,
  kept_name              text not null,
  kept_lightspeed_name   text,
  merged_name            text not null,
  merged_lightspeed_name text,                                    -- null = the merged vendor was VMS-only (nothing to do in LS)
  merged_vendor_id       uuid references public.vendors(id) on delete set null,
  source                 text not null default 'manual' check (source in ('import', 'manual')),
  status                 text not null default 'confirmed' check (status in ('pending', 'confirmed', 'split')),
  route                  public.billing_route,                    -- usual route chosen when confirming/merging
  merged_at              timestamptz not null default now(),
  merged_by              uuid references public.profiles(id) on delete set null,
  ls_done_at             timestamptz,
  ls_done_by             uuid references public.profiles(id) on delete set null
);
comment on table public.vendor_merges is 'What got merged into what. Drives the Lightspeed merge report; status pending = auto-merged at import, awaiting confirmation.';
create index if not exists vendor_merges_org_idx on public.vendor_merges (organization_id, status, ls_done_at);
create index if not exists vendor_merges_kept_idx on public.vendor_merges (kept_vendor_id);

alter table public.vendor_merges enable row level security;
drop policy if exists "vendor_merges: members read" on public.vendor_merges;
drop policy if exists "vendor_merges: editors update" on public.vendor_merges;
create policy "vendor_merges: members read" on public.vendor_merges for select to authenticated using (public.user_in_org(organization_id));
create policy "vendor_merges: editors update" on public.vendor_merges for update to authenticated
  using (public.user_can_edit() and public.user_in_org(organization_id)) with check (public.user_can_edit() and public.user_in_org(organization_id));
grant select, update on table public.vendor_merges to authenticated;
grant all on table public.vendor_merges to service_role;

-- Backfill the import-time merges from their pending review items.
insert into public.vendor_merges (organization_id, kept_vendor_id, kept_name, kept_lightspeed_name, merged_name, merged_lightspeed_name, source, status, merged_at)
select r.organization_id, v.id, v.name, v.lightspeed_name, n.name, n.name, 'import', 'pending', r.created_at
from public.review_items r
join public.vendors v on v.id = r.entity_id
cross join lateral jsonb_array_elements_text(r.details->'lightspeed_names') as n(name)
where r.kind = 'vendor_merge' and r.status = 'pending' and n.name is distinct from v.lightspeed_name
  and not exists (select 1 from public.vendor_merges m where m.kept_vendor_id = v.id and m.merged_lightspeed_name = n.name);

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------
-- Make p_route the vendor's usual route (adding it if missing). Null = leave as is.
create or replace function public.set_usual_route(p_vendor uuid, p_route public.billing_route)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if p_route is null then return; end if;
  update public.vendor_billing_routes set is_default = false where vendor_id = p_vendor and is_default and route <> p_route;
  insert into public.vendor_billing_routes (vendor_id, route, is_default) values (p_vendor, p_route, true)
  on conflict (vendor_id, route) do update set is_default = true;
end;
$$;

-- Clear the review flag once nothing is pending for the vendor.
create or replace function public.settle_vendor_review(p_vendor uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if p_vendor is null then return; end if;
  if not exists (
    select 1 from public.review_items where status = 'pending'
      and ((entity_type = 'vendor' and entity_id = p_vendor) or (details->>'other_vendor_id') = p_vendor::text)
  ) then
    update public.vendors set needs_review = false, review_note = null where id = p_vendor and needs_review;
  end if;
end;
$$;

-- Resolve a review item and clear flags on the vendors it concerned.
create or replace function public.resolve_review_item(p_item uuid, p_status public.review_status, p_note text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare
  it public.review_items%rowtype;
begin
  if not public.user_can_edit() then raise exception 'Only editors can resolve review items' using errcode = '42501'; end if;
  select * into it from public.review_items where id = p_item for update;
  if it.id is null or not public.user_in_org(it.organization_id) then raise exception 'Review item not found' using errcode = '23503'; end if;
  if p_status = 'pending' then raise exception 'Use accepted or rejected' using errcode = '22023'; end if;
  update public.review_items set status = p_status, resolved_by = auth.uid(), resolved_at = now(), resolution_note = p_note where id = p_item;
  if it.entity_type = 'vendor' then
    perform public.settle_vendor_review(it.entity_id);
    perform public.settle_vendor_review((it.details->>'other_vendor_id')::uuid);
  end if;
end;
$$;

-- Confirm an import-time merge (Dana looked, it is one vendor), optionally stating the usual route.
create or replace function public.confirm_vendor_merge(p_vendor uuid, p_route public.billing_route default null)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v public.vendors%rowtype;
begin
  if not public.user_can_edit() then raise exception 'Only editors can confirm merges' using errcode = '42501'; end if;
  select * into v from public.vendors where id = p_vendor for update;
  if v.id is null or not public.user_in_org(v.organization_id) then raise exception 'Vendor not found' using errcode = '23503'; end if;
  perform public.set_usual_route(p_vendor, p_route);
  update public.vendor_merges set status = 'confirmed', route = coalesce(p_route, route), merged_by = coalesce(merged_by, auth.uid())
    where kept_vendor_id = p_vendor and status = 'pending';
  update public.review_items set status = 'accepted', resolved_by = auth.uid(), resolved_at = now(), resolution_note = 'Confirmed'
    where status = 'pending' and kind = 'vendor_merge' and entity_id = p_vendor;
  perform public.settle_vendor_review(p_vendor);
  insert into public.activity_log (organization_id, entity_type, entity_id, action, details, actor_id)
  values (v.organization_id, 'vendor', p_vendor, 'merge_confirmed', jsonb_build_object('route', p_route), auth.uid());
end;
$$;

-- ---------------------------------------------------------------------------
-- Merge p_remove into p_keep: union aliases/routes/contacts/windows/stores/categories,
-- fill empty fields on p_keep from p_remove, re-point notes/activity, deactivate p_remove.
-- ---------------------------------------------------------------------------
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

-- ---------------------------------------------------------------------------
-- Split one Lightspeed name back out of a vendor (undo an import-time or manual merge).
-- Reuses the merged-away row when there is one; otherwise creates a new vendor.
-- ---------------------------------------------------------------------------
create or replace function public.unmerge_vendor(p_vendor uuid, p_lightspeed_name text, p_route public.billing_route default null)
returns uuid
language plpgsql security definer
set search_path = ''
as $$
declare
  v public.vendors%rowtype;
  v_clean text;
  v_route public.billing_route;
  v_new uuid;
  v_remaining int;
begin
  if not public.user_can_edit() then
    raise exception 'Only editors can split vendors' using errcode = '42501';
  end if;
  select * into v from public.vendors where id = p_vendor for update;
  if v.id is null or not public.user_in_org(v.organization_id) then
    raise exception 'Vendor not found' using errcode = '23503';
  end if;
  if not (p_lightspeed_name = any(v.aliases)) then
    raise exception 'That Lightspeed name is not an alias of this vendor' using errcode = '22023';
  end if;
  v_route := coalesce(p_route, case
    when p_lightspeed_name ~* '(^|[^a-z0-9])(not|non)[\s-]*wwd([^a-z0-9]|$)' then 'direct'::public.billing_route
    when p_lightspeed_name ~* '(^|[^a-z0-9])wwd([^a-z0-9]|$)' then 'worldwide'::public.billing_route
    when p_lightspeed_name ~* '(^|[^a-z0-9])faire([^a-z0-9]|$)' then 'faire'::public.billing_route
    else null end);
  v_clean := trim(both ' -–/(),.&' from regexp_replace(regexp_replace(p_lightspeed_name, '(^|[^A-Za-z0-9])((not|non)[\s-]*wwd|wwd|faire)([^A-Za-z0-9]|$)', ' ', 'gi'), '\*', ' ', 'g'));
  v_clean := regexp_replace(v_clean, '\s{2,}', ' ', 'g');
  if v_clean = '' or lower(v_clean) = lower(v.name) then
    v_clean := p_lightspeed_name;
  end if;

  -- A vendor that was merged into this one earlier comes back as itself.
  select id into v_new from public.vendors
    where merged_into_id = p_vendor and not is_active
      and (lightspeed_name = p_lightspeed_name or lower(name) = lower(v_clean) or lower(name) = lower(p_lightspeed_name))
    order by created_at limit 1;
  if v_new is not null then
    update public.vendors set is_active = true, merged_into_id = null, needs_review = true,
      review_note = 'Split back out of "' || v.name || '". Check details.' where id = v_new;
  else
    if exists (select 1 from public.vendors where organization_id = v.organization_id and lower(name) = lower(v_clean)) then
      v_clean := p_lightspeed_name;
    end if;
    if exists (select 1 from public.vendors where organization_id = v.organization_id and lower(name) = lower(v_clean)) then
      raise exception 'A vendor named "%" already exists', v_clean using errcode = '23505';
    end if;
    insert into public.vendors (organization_id, name, lightspeed_name, aliases, needs_review, review_note, created_by)
    values (v.organization_id, v_clean, p_lightspeed_name, array[p_lightspeed_name]::text[], true, 'Split from "' || v.name || '". Check details.', auth.uid())
    returning id into v_new;
  end if;
  perform public.set_usual_route(v_new, v_route);

  update public.vendors set aliases = array_remove(aliases, p_lightspeed_name) where id = p_vendor;
  update public.vendor_merges set status = 'split' where kept_vendor_id = p_vendor and merged_lightspeed_name = p_lightspeed_name and status <> 'split';

  -- The import's merge item either shrinks or closes.
  select count(*) into v_remaining from public.vendor_merges where kept_vendor_id = p_vendor and status = 'pending';
  if v_remaining = 0 then
    update public.review_items set status = 'rejected', resolved_by = auth.uid(), resolved_at = now(), resolution_note = 'Split'
    where status = 'pending' and kind = 'vendor_merge' and entity_id = p_vendor;
  else
    update public.review_items set details = details || jsonb_build_object('lightspeed_names',
      (select coalesce(jsonb_agg(x), '[]'::jsonb) from jsonb_array_elements_text(details->'lightspeed_names') as x where x <> p_lightspeed_name))
    where status = 'pending' and kind = 'vendor_merge' and entity_id = p_vendor;
  end if;
  perform public.settle_vendor_review(p_vendor);

  insert into public.activity_log (organization_id, entity_type, entity_id, action, details, actor_id)
  values (v.organization_id, 'vendor', p_vendor, 'split', jsonb_build_object('new_vendor_id', v_new, 'lightspeed_name', p_lightspeed_name, 'route', v_route), auth.uid());
  return v_new;
end;
$$;

revoke execute on function public.set_usual_route(uuid, public.billing_route) from public, anon, authenticated;
revoke execute on function public.settle_vendor_review(uuid) from public, anon, authenticated;
revoke execute on function public.resolve_review_item(uuid, public.review_status, text) from public, anon;
revoke execute on function public.confirm_vendor_merge(uuid, public.billing_route) from public, anon;
revoke execute on function public.merge_vendors(uuid, uuid, public.billing_route) from public, anon;
revoke execute on function public.unmerge_vendor(uuid, text, public.billing_route) from public, anon;
grant execute on function public.resolve_review_item(uuid, public.review_status, text) to authenticated, service_role;
grant execute on function public.confirm_vendor_merge(uuid, public.billing_route) to authenticated, service_role;
grant execute on function public.merge_vendors(uuid, uuid, public.billing_route) to authenticated, service_role;
grant execute on function public.unmerge_vendor(uuid, text, public.billing_route) to authenticated, service_role;
