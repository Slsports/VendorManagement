-- =============================================================================
-- 0011 — Rep lines, show attendance, links & files, WWD zero upcharge,
-- name clean-up proposals (Dana, 2026-10-06).
--   * vendor_directory becomes "lines": one row per line per organization. A line is
--     something a rep carries or a show lists. It is NOT a vendor until promoted.
--   * show_appearances: which Worldwide show a line/vendor exhibited at, booth, exhibitor.
--   * vendor_links: catalog / price list / order form links and uploaded files.
--   * vendors.wwd_zero_upcharge: no 1.5% WWD drop-ship upcharge.
--   * review kind vendor_rename: proposed clean-ups of tagged Lightspeed names.
-- =============================================================================

-- ---- lines ------------------------------------------------------------------
alter table public.vendor_directory drop constraint if exists vendor_directory_organization_id_source_name_key_key;
create unique index if not exists vendor_directory_org_line_key on public.vendor_directory (organization_id, name_key);
alter table public.vendor_directory
  add column if not exists rep_group_id   uuid references public.rep_groups(id) on delete set null,
  add column if not exists catalog_url    text,
  add column if not exists specials       text,
  add column if not exists specials_label text,
  add column if not exists zero_upcharge  boolean not null default false,
  add column if not exists notes          text,
  add column if not exists updated_at     timestamptz not null default now();
comment on table public.vendor_directory is 'Lines: what reps carry and what shows list. Not vendors. matched_vendor_id links a line to the vendor record when we buy from it.';
comment on column public.vendor_directory.source is 'Where the line was first seen (e.g. rep_dandylines, wwd_fall_2026).';
create index if not exists vendor_directory_rep_group_idx on public.vendor_directory (rep_group_id);
drop trigger if exists vendor_directory_touch on public.vendor_directory;
create trigger vendor_directory_touch before update on public.vendor_directory for each row execute function public.set_updated_at();

-- ---- show attendance --------------------------------------------------------
create table if not exists public.show_appearances (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  show_code       text not null,                 -- wwd_spring_2026, wwd_fall_2026
  show_label      text not null,                 -- "Fall 2026 (Reno, Sept 1-3)"
  show_date       date,
  line_id         uuid not null references public.vendor_directory(id) on delete cascade,
  vendor_id       uuid references public.vendors(id) on delete set null,
  booth           text,
  exhibitor       text,                          -- who held the booth (rep group or parent company)
  is_new          boolean not null default false,
  created_at      timestamptz not null default now(),
  unique (organization_id, show_code, line_id)
);
comment on table public.show_appearances is 'One row per line per Worldwide show. Booth-mates = same show_code + booth.';
create index if not exists show_appearances_vendor_idx on public.show_appearances (vendor_id);
create index if not exists show_appearances_booth_idx on public.show_appearances (organization_id, show_code, booth);
alter table public.show_appearances enable row level security;
drop policy if exists "show_appearances: members read" on public.show_appearances;
drop policy if exists "show_appearances: editors write" on public.show_appearances;
create policy "show_appearances: members read" on public.show_appearances for select to authenticated using (public.user_in_org(organization_id));
create policy "show_appearances: editors write" on public.show_appearances for all to authenticated
  using (public.user_can_edit() and public.user_in_org(organization_id)) with check (public.user_can_edit() and public.user_in_org(organization_id));
grant select, insert, update, delete on table public.show_appearances to authenticated;
grant all on table public.show_appearances to service_role;

-- ---- zero upcharge ----------------------------------------------------------
alter table public.vendors add column if not exists wwd_zero_upcharge boolean not null default false;
comment on column public.vendors.wwd_zero_upcharge is 'Worldwide charges 1.5% to drop-ship most vendors; zero-upcharge vendors do not carry it.';

-- ---- links & files ----------------------------------------------------------
create table if not exists public.vendor_links (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  vendor_id       uuid references public.vendors(id) on delete cascade,
  line_id         uuid references public.vendor_directory(id) on delete cascade,
  kind            text not null check (kind in ('catalog', 'price_list', 'order_form', 'specials', 'website', 'other')),
  label           text not null,
  url             text,
  storage_path    text,                          -- vendor-files/<org>/<vendor or line>/<uuid>-<file>
  file_name       text,
  file_size       bigint,
  mime_type       text,
  season_label    text,                          -- "Fall 2026", "2026 catalog"
  received_at     date,
  source          text not null default 'manual' check (source in ('manual', 'rep_list', 'email', 'vendor_form')),
  notes           text,
  created_by      uuid references public.profiles(id) on delete set null,
  created_at      timestamptz not null default now(),
  check (vendor_id is not null or line_id is not null),
  check (url is not null or storage_path is not null)
);
comment on table public.vendor_links is 'Catalogs, price lists, order forms: links or uploaded files, per vendor or per line. Old ones stay as history.';
create index if not exists vendor_links_vendor_idx on public.vendor_links (vendor_id, created_at desc);
create index if not exists vendor_links_line_idx on public.vendor_links (line_id);
alter table public.vendor_links enable row level security;
drop policy if exists "vendor_links: members read" on public.vendor_links;
drop policy if exists "vendor_links: editors write" on public.vendor_links;
create policy "vendor_links: members read" on public.vendor_links for select to authenticated using (public.user_in_org(organization_id));
create policy "vendor_links: editors write" on public.vendor_links for all to authenticated
  using (public.user_can_edit() and public.user_in_org(organization_id)) with check (public.user_can_edit() and public.user_in_org(organization_id));
grant select, insert, update, delete on table public.vendor_links to authenticated;
grant all on table public.vendor_links to service_role;

-- Private bucket; object paths start with the organization id so RLS can scope them.
insert into storage.buckets (id, name, public, file_size_limit)
values ('vendor-files', 'vendor-files', false, 26214400)
on conflict (id) do nothing;
drop policy if exists "vendor-files: members read" on storage.objects;
drop policy if exists "vendor-files: editors insert" on storage.objects;
drop policy if exists "vendor-files: editors update" on storage.objects;
drop policy if exists "vendor-files: editors delete" on storage.objects;
create policy "vendor-files: members read" on storage.objects for select to authenticated
  using (bucket_id = 'vendor-files' and public.user_in_org(((storage.foldername(name))[1])::uuid));
create policy "vendor-files: editors insert" on storage.objects for insert to authenticated
  with check (bucket_id = 'vendor-files' and public.user_can_edit() and public.user_in_org(((storage.foldername(name))[1])::uuid));
create policy "vendor-files: editors update" on storage.objects for update to authenticated
  using (bucket_id = 'vendor-files' and public.user_can_edit() and public.user_in_org(((storage.foldername(name))[1])::uuid));
create policy "vendor-files: editors delete" on storage.objects for delete to authenticated
  using (bucket_id = 'vendor-files' and public.user_can_edit() and public.user_in_org(((storage.foldername(name))[1])::uuid));

-- ---- promote a line to a vendor ---------------------------------------------
create or replace function public.promote_line_to_vendor(p_line uuid, p_route public.billing_route default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  l public.vendor_directory%rowtype;
  v_id uuid;
  v_route public.billing_route;
begin
  if not public.user_can_edit() then raise exception 'Only editors can add vendors' using errcode = '42501'; end if;
  select * into l from public.vendor_directory where id = p_line for update;
  if l.id is null or not public.user_in_org(l.organization_id) then raise exception 'Line not found' using errcode = '23503'; end if;
  if l.matched_vendor_id is not null then return l.matched_vendor_id; end if;
  select id into v_id from public.vendors where organization_id = l.organization_id and lower(name) = lower(l.name);
  if v_id is null then
    insert into public.vendors (organization_id, name, website, phone, rep_name, rep_group_id, wwd_zero_upcharge, notes, created_by)
    values (l.organization_id, l.name, l.website, l.phone, l.rep_name, l.rep_group_id, l.zero_upcharge, l.notes, auth.uid())
    returning id into v_id;
    v_route := coalesce(p_route, l.route);
    if v_route is not null then
      insert into public.vendor_billing_routes (vendor_id, route, is_default) values (v_id, v_route, true);
    end if;
    if l.email is not null then
      insert into public.vendor_emails (vendor_id, email, contact_name, contact_type, source)
      values (v_id, l.email, l.rep_name, 'rep', 'import') on conflict do nothing;
    end if;
    insert into public.activity_log (organization_id, entity_type, entity_id, action, details, actor_id)
    values (l.organization_id, 'vendor', v_id, 'created', jsonb_build_object('from_line', l.id, 'source', l.source), auth.uid());
  end if;
  update public.vendor_directory set matched_vendor_id = v_id where id = p_line;
  update public.show_appearances set vendor_id = v_id where line_id = p_line and vendor_id is null;
  update public.vendor_links set vendor_id = v_id where line_id = p_line and vendor_id is null;
  if l.catalog_url is not null and not exists (select 1 from public.vendor_links where vendor_id = v_id and url = l.catalog_url) then
    insert into public.vendor_links (organization_id, vendor_id, line_id, kind, label, url, season_label, source, created_by)
    values (l.organization_id, v_id, p_line, 'catalog', 'Catalog (from rep line list)', l.catalog_url, l.specials_label, 'rep_list', auth.uid());
  end if;
  return v_id;
end;
$$;

-- ---- apply a proposed name clean-up ------------------------------------------
-- Review item kind vendor_rename, details: {current_name, new_name, alias, rep_group_name, rep_group_id}.
create or replace function public.apply_vendor_rename(p_item uuid, p_new_name text default null, p_rep_group_id uuid default null)
returns void language plpgsql security definer set search_path = '' as $$
declare
  it public.review_items%rowtype;
  v public.vendors%rowtype;
  v_name text;
  v_alias text;
  v_group uuid;
begin
  if not public.user_can_edit() then raise exception 'Only editors can rename vendors' using errcode = '42501'; end if;
  select * into it from public.review_items where id = p_item for update;
  if it.id is null or not public.user_in_org(it.organization_id) or it.kind <> 'vendor_rename' then raise exception 'Rename proposal not found' using errcode = '23503'; end if;
  if it.status <> 'pending' then return; end if;
  select * into v from public.vendors where id = it.entity_id for update;
  if v.id is null then raise exception 'Vendor not found' using errcode = '23503'; end if;
  v_name := nullif(trim(coalesce(p_new_name, it.details->>'new_name')), '');
  if v_name is null then raise exception 'A name is required' using errcode = '22023'; end if;
  if lower(v_name) <> lower(v.name) and exists (select 1 from public.vendors where organization_id = v.organization_id and lower(name) = lower(v_name) and id <> v.id) then
    raise exception 'A vendor named "%" already exists', v_name using errcode = '23505';
  end if;
  v_alias := nullif(trim(it.details->>'alias'), '');
  v_group := coalesce(p_rep_group_id, (it.details->>'rep_group_id')::uuid);
  update public.vendors set
    name = v_name,
    aliases = (select array(select distinct x from unnest(aliases || array[v.name, v_alias]::text[]) as x where x is not null and x <> v_name)),
    rep_group_id = coalesce(rep_group_id, v_group)
  where id = v.id;
  update public.review_items set status = 'accepted', resolved_by = auth.uid(), resolved_at = now(), resolution_note = 'Renamed to ' || v_name where id = p_item;
  perform public.settle_vendor_review(v.id);
  insert into public.activity_log (organization_id, entity_type, entity_id, action, details, actor_id)
  values (v.organization_id, 'vendor', v.id, 'renamed', jsonb_build_object('from', v.name, 'to', v_name, 'alias', v_alias, 'rep_group_id', v_group), auth.uid());
end;
$$;

revoke execute on function public.promote_line_to_vendor(uuid, public.billing_route) from public, anon;
revoke execute on function public.apply_vendor_rename(uuid, text, uuid) from public, anon;
grant execute on function public.promote_line_to_vendor(uuid, public.billing_route) to authenticated, service_role;
grant execute on function public.apply_vendor_rename(uuid, text, uuid) to authenticated, service_role;
