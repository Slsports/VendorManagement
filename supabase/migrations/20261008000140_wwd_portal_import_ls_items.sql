-- 140: the Worldwide portal comes into VMS, and every vendor shows its Lightspeed items (Dana, Oct 16, "go!!").
--
-- Worldwide portal (docs/wwd-portal-import.md): Dana's "Read all vendors" bookmark sent all 1,825 portal vendors. Each
-- one is kept in wwd_portal_vendors (as read, for the vendor page's Worldwide portal card) and tied to our vendor when
-- the name is sure (the same name or other name, or a show-list line Dana already tied). For our vendors the portal
-- fills what VMS left empty (address, phones, minimum order, terms, free shipping, freight terms, returns) and adds
-- its people as unconfirmed contacts; where Dana typed something different, hers stays and a "Worldwide portal" card in
-- the review queue asks which to keep. Programs (standard and each show) go to vendor_programs and are never dropped.
-- A name that only looks alike becomes a line with a card ("Is … our vendor …?"); everyone else becomes a line,
-- "not bought from yet". When a line is tied to a vendor later (the card, or Make it a vendor), its portal details
-- land on that vendor the same way.
--
-- Lightspeed items: VMS reads every LS item (active and archived) with its vendor and counts them per vendor. A vendor
-- with active items is "Active", one with only archived items "Inactive", one with none "No items in LS". This is a
-- label for priorities (Dana: active vendors first for the update emails, then inactive, then never purchased from);
-- it does not change the vendor's own Active switch, which hides a vendor from pick lists.

alter type public.contact_source add value if not exists 'wwd_portal';

-- ---- Worldwide portal vendors, as read ----------------------------------------------------------------------------
create table if not exists public.wwd_portal_vendors (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  number          text not null,
  name            text not null,
  data            jsonb not null,
  read_at         timestamptz not null,
  vendor_id       uuid references public.vendors(id) on delete set null,
  line_id         uuid references public.vendor_directory(id) on delete set null,
  match_how       text check (match_how in ('exact', 'line', 'confirmed', 'manual')),
  applied_at      timestamptz,
  applied         jsonb,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (organization_id, number)
);
comment on table public.wwd_portal_vendors is 'Each vendor in the Worldwide portal as last read (data = address, contacts, programs, product lines, returns), tied to our vendor or to a line.';
create index if not exists wwd_portal_vendors_vendor on public.wwd_portal_vendors (vendor_id) where vendor_id is not null;
create index if not exists wwd_portal_vendors_line on public.wwd_portal_vendors (line_id) where line_id is not null;
alter table public.wwd_portal_vendors enable row level security;
drop policy if exists "wwd_portal_vendors: members read" on public.wwd_portal_vendors;
create policy "wwd_portal_vendors: members read" on public.wwd_portal_vendors for select to authenticated using (public.user_in_org(organization_id));
grant select on public.wwd_portal_vendors to authenticated;
grant all on public.wwd_portal_vendors to service_role;
drop trigger if exists wwd_portal_vendors_updated_at on public.wwd_portal_vendors;
create trigger wwd_portal_vendors_updated_at before update on public.wwd_portal_vendors for each row execute function public.set_updated_at();

-- ---- vendor programs (standard terms and each show), history kept -------------------------------------------------
create table if not exists public.vendor_programs (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  vendor_id       uuid not null references public.vendors(id) on delete cascade,
  source          text not null default 'manual' check (source in ('wwd_portal', 'manual')),
  portal_number   text not null default '',
  key             text not null,
  name            text not null,
  kind            text not null default 'standard' check (kind in ('standard', 'show')),
  season          text,
  year            integer,
  expires_on      date,
  ship_begin      date,
  ship_end        date,
  discount        text,
  billing_terms   text,
  freight_terms   text,
  freight_tiers   jsonb not null default '[]'::jsonb,
  minimum_order   text,
  shipping_points text,
  documents       jsonb not null default '[]'::jsonb,
  notes           text,
  read_at         timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (vendor_id, source, portal_number, key)
);
comment on table public.vendor_programs is 'A vendor''s buying programs (Standard, Fall Show 2026, …) with terms, freight tiers and dates. Never dropped: expired ones stay for orders placed under them.';
alter table public.vendor_programs enable row level security;
drop policy if exists "vendor_programs: members read" on public.vendor_programs;
create policy "vendor_programs: members read" on public.vendor_programs for select to authenticated using (public.user_in_org(organization_id));
drop policy if exists "vendor_programs: editors write" on public.vendor_programs;
create policy "vendor_programs: editors write" on public.vendor_programs for all to authenticated
  using (public.user_can_edit() and public.user_in_org(organization_id)) with check (public.user_can_edit() and public.user_in_org(organization_id));
grant select, insert, update, delete on public.vendor_programs to authenticated;
grant all on public.vendor_programs to service_role;
drop trigger if exists vendor_programs_updated_at on public.vendor_programs;
create trigger vendor_programs_updated_at before update on public.vendor_programs for each row execute function public.set_updated_at();

-- ---- comparing a portal value with ours ---------------------------------------------------------------------------
create or replace function public.portal_same(p_field text, p_ours text, p_portal text)
returns boolean language sql immutable as $$
  select case
    when p_field in ('phone', 'fax') then
      left(regexp_replace(regexp_replace(coalesce(p_ours, ''), '\D', '', 'g'), '^1(?=\d{10})', ''), 10)
      = left(regexp_replace(regexp_replace(coalesce(p_portal, ''), '\D', '', 'g'), '^1(?=\d{10})', ''), 10)
    when p_field = 'postal_code' then left(coalesce(p_ours, ''), 5) = left(coalesce(p_portal, ''), 5)
    when p_field = 'free_shipping_threshold' then coalesce(p_ours, '')::text = coalesce(p_portal, '')::text
      or (p_ours ~ '^\d+(\.\d+)?$' and p_portal ~ '^\d+(\.\d+)?$' and p_ours::numeric = p_portal::numeric)
    else regexp_replace(lower(coalesce(p_ours, '')), '[^a-z0-9]', '', 'g') = regexp_replace(lower(coalesce(p_portal, '')), '[^a-z0-9]', '', 'g')
  end
$$;

-- The vendor fields the portal may fill, with their labels.
create or replace function public.portal_field_label(p_field text)
returns text language sql immutable as $$
  select case p_field
    when 'address' then 'Address' when 'city' then 'City' when 'state' then 'State' when 'postal_code' then 'ZIP'
    when 'phone' then 'Phone' when 'fax' then 'Fax' when 'minimum_order' then 'Minimum order'
    when 'freight_program' then 'Freight terms' when 'free_shipping_policy' then 'Free shipping'
    when 'free_shipping_threshold' then 'Free shipping at $' when 'return_notes' then 'Returns' end
$$;

/**
 * Land one portal vendor on our vendor (no permission check: the import, the line trigger and the review card call it).
 * Empty fields are filled; a different value Dana typed stays and gets a "Worldwide portal" card. People are added as
 * unconfirmed contacts (a rep at the vendor's own rep group goes on the group). Programs are added or refreshed.
 */
create or replace function public.wwd_portal_apply(p_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  w        public.wwd_portal_vendors%rowtype;
  v        public.vendors%rowtype;
  d        jsonb;
  f        text;
  portal   text;
  ours     text;
  filled   text[] := '{}';
  asked    text[] := '{}';
  c        jsonb;
  p        jsonb;
  v_email  text;
  v_group  text;
  people   integer := 0;
  reps     integer := 0;
  programs integer := 0;
  v_terms  uuid;
begin
  select * into w from public.wwd_portal_vendors where id = p_id;
  if not found or w.vendor_id is null then return null; end if;
  select * into v from public.vendors where id = w.vendor_id;
  if not found then return null; end if;
  d := w.data;

  foreach f in array array['address', 'city', 'state', 'postal_code', 'phone', 'fax', 'minimum_order', 'freight_program', 'free_shipping_policy', 'free_shipping_threshold', 'return_notes'] loop
    portal := nullif(trim(case
      when f in ('address', 'city', 'state', 'postal_code', 'phone', 'fax') then d->'address'->>f
      when f = 'return_notes' then d->>'return_notes'
      else d->'standard'->>f end), '');
    if portal is null then continue; end if;
    execute format('select %I::text from public.vendors where id = $1', f) into ours using v.id;
    if nullif(trim(ours), '') is null then
      execute format('update public.vendors set %I = $1::%s where id = $2', f,
                     case when f = 'free_shipping_threshold' then 'numeric' else 'text' end) using portal, v.id;
      filled := filled || f;
    elsif not public.portal_same(f, ours, portal)
      and not exists (select 1 from public.review_items r where r.kind = 'portal_conflict' and r.entity_id = v.id
                        and r.details->>'field' = f and r.details->>'portal' = portal) then
      insert into public.review_items (organization_id, kind, entity_type, entity_id, title, details)
      values (v.organization_id, 'portal_conflict', 'vendor', v.id,
              format('%s: the Worldwide portal says a different %s', v.name, lower(public.portal_field_label(f))),
              jsonb_build_object('vendor_id', v.id, 'vendor_name', v.name, 'vendor_id_for_rules', v.id, 'field', f,
                                 'label', public.portal_field_label(f), 'ours', ours, 'portal', portal,
                                 'portal_name', w.name, 'read_at', w.read_at));
      asked := asked || f;
    end if;
  end loop;

  -- payment terms: only a name we already use ("Net 30 Days" = Net 30)
  if v.payment_terms_id is null and nullif(d->'standard'->>'billing_terms', '') is not null then
    select t.id into v_terms from public.payment_terms t
     where trim(regexp_replace(regexp_replace(lower(t.name), '\mdays?\M', '', 'g'), '\s+', ' ', 'g'))
         = trim(regexp_replace(regexp_replace(lower(d->'standard'->>'billing_terms'), '\mdays?\M', '', 'g'), '\s+', ' ', 'g'))
     limit 1;
    if v_terms is not null then
      update public.vendors set payment_terms_id = v_terms where id = v.id;
      filled := filled || 'payment_terms'::text;
    end if;
  end if;

  -- people
  select name into v_group from public.rep_groups where id = v.rep_group_id;
  for c in select * from jsonb_array_elements(coalesce(d->'contacts', '[]'::jsonb)) loop
    v_email := lower(nullif(c->>'email', ''));
    if v_email is null then continue; end if;
    if v.rep_group_id is not null and exists (select 1 from public.rep_group_contacts g where g.rep_group_id = v.rep_group_id and lower(g.email) = v_email) then continue; end if;
    if exists (select 1 from public.vendor_emails e where e.vendor_id = v.id and lower(e.email) = v_email) then continue; end if;
    if nullif(c->>'company', '') is not null and v_group is not null
       and (public.name_norm(c->>'company') = public.name_norm(v_group)
            or public.name_norm(c->>'company') like public.name_norm(v_group) || ' %'
            or public.name_norm(v_group) like public.name_norm(c->>'company') || ' %') then
      insert into public.rep_group_contacts (organization_id, rep_group_id, name, title, email, phone, phones, notes)
      values (v.organization_id, v.rep_group_id, c->>'name', nullif(c->>'title', ''), v_email,
              coalesce(c->'phones'->0->>'number', null), coalesce(c->'phones', '[]'::jsonb),
              concat_ws(' · ', 'From the Worldwide portal (' || v.name || ')', nullif(c->>'territory', '')));
      reps := reps + 1;
      continue;
    end if;
    insert into public.vendor_emails (organization_id, vendor_id, email, contact_name, title, phone, phones, contact_type, roles, source, notes)
    values (v.organization_id, v.id, v_email, c->>'name', nullif(c->>'title', ''), c->'phones'->0->>'number', coalesce(c->'phones', '[]'::jsonb),
            (c->>'kind')::public.contact_type, array[(c->>'kind')::public.contact_type], 'wwd_portal',
            concat_ws(' · ', 'From the Worldwide portal, read ' || to_char(w.read_at at time zone 'America/Los_Angeles', 'Mon FMDD, YYYY'),
                      case when nullif(c->>'company', '') is not null then 'Rep company: ' || (c->>'company') end,
                      case when nullif(c->>'territory', '') is not null then 'Territory: ' || (c->>'territory') end))
    on conflict do nothing;
    people := people + 1;
  end loop;

  -- programs (never dropped; a re-read refreshes them)
  for p in select * from jsonb_array_elements(coalesce(d->'programs', '[]'::jsonb)) loop
    insert into public.vendor_programs (organization_id, vendor_id, source, portal_number, key, name, kind, season, year, expires_on, ship_begin, ship_end,
                                        discount, billing_terms, freight_terms, freight_tiers, minimum_order, shipping_points, documents, read_at)
    values (v.organization_id, v.id, 'wwd_portal', w.number, p->>'key', p->>'name', p->>'kind', p->>'season', (p->>'year')::integer,
            (p->>'expires_on')::date, (p->>'ship_begin')::date, (p->>'ship_end')::date, p->>'discount', p->>'billing_terms', p->>'freight_terms',
            coalesce(p->'freight_tiers', '[]'::jsonb), p->>'minimum_order', p->>'shipping_points', coalesce(p->'documents', '[]'::jsonb), w.read_at)
    on conflict (vendor_id, source, portal_number, key) do update set
      name = excluded.name, kind = excluded.kind, season = excluded.season, year = excluded.year, expires_on = excluded.expires_on,
      ship_begin = excluded.ship_begin, ship_end = excluded.ship_end, discount = excluded.discount, billing_terms = excluded.billing_terms,
      freight_terms = excluded.freight_terms, freight_tiers = excluded.freight_tiers, minimum_order = excluded.minimum_order,
      shipping_points = excluded.shipping_points, documents = excluded.documents, read_at = excluded.read_at;
    programs := programs + 1;
  end loop;

  update public.wwd_portal_vendors
     set applied_at = now(), applied = jsonb_build_object('filled', to_jsonb(filled), 'asked', to_jsonb(asked), 'people', people, 'reps', reps, 'programs', programs)
   where id = w.id;
  return jsonb_build_object('filled', to_jsonb(filled), 'asked', to_jsonb(asked), 'people', people, 'reps', reps, 'programs', programs);
end;
$$;
revoke execute on function public.wwd_portal_apply(uuid) from public, anon, authenticated;
grant execute on function public.wwd_portal_apply(uuid) to service_role;

/** Every portal vendor tied to one of ours that is new or re-read since it last landed. Returns the totals. */
create or replace function public.wwd_portal_apply_all(p_org uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  r      record;
  a      jsonb;
  f      text;
  filled jsonb := '{}'::jsonb;
  asked  jsonb := '{}'::jsonb;
  n      integer := 0;
  people integer := 0;
  reps   integer := 0;
  progs  integer := 0;
begin
  for r in select id from public.wwd_portal_vendors
            where organization_id = p_org and vendor_id is not null and (applied_at is null or applied_at < updated_at) loop
    a := public.wwd_portal_apply(r.id);
    if a is null then continue; end if;
    n := n + 1;
    people := people + (a->>'people')::integer; reps := reps + (a->>'reps')::integer; progs := progs + (a->>'programs')::integer;
    for f in select jsonb_array_elements_text(a->'filled') loop filled := jsonb_set(filled, array[f], to_jsonb(coalesce((filled->>f)::integer, 0) + 1)); end loop;
    for f in select jsonb_array_elements_text(a->'asked') loop asked := jsonb_set(asked, array[f], to_jsonb(coalesce((asked->>f)::integer, 0) + 1)); end loop;
  end loop;
  return jsonb_build_object('vendors', n, 'filled', filled, 'asked', asked, 'people', people, 'reps', reps, 'programs', progs);
end;
$$;
revoke execute on function public.wwd_portal_apply_all(uuid) from public, anon, authenticated;
grant execute on function public.wwd_portal_apply_all(uuid) to service_role;

-- A line tied to a vendor later (the review card, Make it a vendor): its portal details land on the vendor.
create or replace function public.line_portal_to_vendor()
returns trigger language plpgsql security definer set search_path = public as $$
declare r record;
begin
  if new.matched_vendor_id is null or old.matched_vendor_id is not distinct from new.matched_vendor_id then return new; end if;
  for r in update public.wwd_portal_vendors set vendor_id = new.matched_vendor_id, match_how = 'confirmed'
            where line_id = new.id and vendor_id is null returning id loop
    perform public.wwd_portal_apply(r.id);
  end loop;
  return new;
end;
$$;
drop trigger if exists vendor_directory_portal_to_vendor on public.vendor_directory;
create trigger vendor_directory_portal_to_vendor after update of matched_vendor_id on public.vendor_directory
  for each row execute function public.line_portal_to_vendor();

-- A merged-away vendor's portal record and programs move to the vendor it was merged into.
create or replace function public.vendor_merged_portal()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.merged_into_id is null or old.merged_into_id is not distinct from new.merged_into_id then return new; end if;
  update public.wwd_portal_vendors set vendor_id = new.merged_into_id where vendor_id = new.id;
  update public.vendor_programs p set vendor_id = new.merged_into_id where p.vendor_id = new.id
     and not exists (select 1 from public.vendor_programs k where k.vendor_id = new.merged_into_id and k.source = p.source and k.portal_number = p.portal_number and k.key = p.key);
  return new;
end;
$$;
drop trigger if exists vendors_merged_portal on public.vendors;
create trigger vendors_merged_portal after update of merged_into_id on public.vendors
  for each row execute function public.vendor_merged_portal();

-- A person answers a "Worldwide portal" card: use the portal's value, or keep ours.
create or replace function public.resolve_portal_conflict(p_item uuid, p_use_portal boolean)
returns void language plpgsql security definer set search_path = public as $$
declare
  r public.review_items%rowtype;
  f text;
begin
  if not public.user_can_edit() then raise exception 'Only admins, managers and buyers decide this' using errcode = '42501'; end if;
  select * into r from public.review_items where id = p_item for update;
  if not found or not public.user_in_org(r.organization_id) or r.kind <> 'portal_conflict' then raise exception 'Card not found'; end if;
  if r.status <> 'pending' then return; end if;
  f := r.details->>'field';
  if public.portal_field_label(f) is null then raise exception 'Unknown field'; end if;
  if p_use_portal then
    execute format('update public.vendors set %I = $1::%s where id = $2', f, case when f = 'free_shipping_threshold' then 'numeric' else 'text' end)
      using r.details->>'portal', r.entity_id;
  end if;
  update public.review_items set status = case when p_use_portal then 'accepted'::public.review_status else 'rejected'::public.review_status end,
         resolved_by = auth.uid(), resolved_at = now(), resolution_note = case when p_use_portal then 'Used the portal''s' else 'Kept ours' end
   where id = p_item;
end;
$$;
revoke execute on function public.resolve_portal_conflict(uuid, boolean) from public, anon;
grant execute on function public.resolve_portal_conflict(uuid, boolean) to authenticated, service_role;
grant execute on function public.portal_same(text, text, text), public.portal_field_label(text) to authenticated, service_role;

-- ---- Lightspeed items per vendor ----------------------------------------------------------------------------------
alter table public.ls_vendors add column if not exists active_items integer;
alter table public.ls_vendors add column if not exists archived_items integer;

alter table public.vendors add column if not exists ls_active_items integer;
alter table public.vendors add column if not exists ls_archived_items integer;
alter table public.vendors add column if not exists ls_items_checked_at timestamptz;
do $$ begin
  alter table public.vendors add column ls_status text generated always as (
    case when ls_items_checked_at is null then null
         when coalesce(ls_active_items, 0) > 0 then 'active'
         when coalesce(ls_archived_items, 0) > 0 then 'inactive'
         else 'none' end) stored;
exception when duplicate_column then null;
end $$;
comment on column public.vendors.ls_status is 'From the vendor''s items in Lightspeed: active (has active items), inactive (only archived items), none (no items). Null: not tied to an LS vendor.';
create index if not exists vendors_ls_status on public.vendors (organization_id, ls_status);

-- One reading of all LS items, a page at a time (LS allows about one request a second), so it can run over several minutes.
create table if not exists public.ls_item_scans (
  organization_id uuid primary key references public.organizations(id) on delete cascade,
  started_at      timestamptz,
  finished_at     timestamptz,
  cursor          text,
  pages           integer not null default 0,
  items           integer not null default 0,
  archived        integer not null default 0,
  no_vendor       integer not null default 0,
  counts          jsonb not null default '{}'::jsonb,
  last_error      text,
  lock_until      timestamptz,
  updated_at      timestamptz not null default now()
);
comment on table public.ls_item_scans is 'The running or last reading of every Lightspeed item; counts = {LS vendor id: [active, archived]}.';
alter table public.ls_item_scans enable row level security;
drop policy if exists "ls_item_scans: members read" on public.ls_item_scans;
create policy "ls_item_scans: members read" on public.ls_item_scans for select to authenticated using (public.user_in_org(organization_id));
grant select on public.ls_item_scans to authenticated;
grant all on public.ls_item_scans to service_role;

/** The finished reading onto LS vendors and our vendors. Returns how many vendors got counts. */
create or replace function public.ls_items_apply(p_org uuid)
returns integer language plpgsql security definer set search_path = public as $$
declare
  s public.ls_item_scans%rowtype;
  n integer;
begin
  select * into s from public.ls_item_scans where organization_id = p_org;
  if not found or s.finished_at is null then return 0; end if;
  update public.ls_vendors l
     set active_items = coalesce((s.counts->l.ls_vendor_id->>0)::integer, 0),
         archived_items = coalesce((s.counts->l.ls_vendor_id->>1)::integer, 0)
   where l.organization_id = p_org;
  update public.vendors v
     set ls_active_items = coalesce((s.counts->v.lightspeed_vendor_id->>0)::integer, 0),
         ls_archived_items = coalesce((s.counts->v.lightspeed_vendor_id->>1)::integer, 0),
         ls_items_checked_at = s.finished_at
   where v.organization_id = p_org and v.lightspeed_vendor_id is not null
     and (v.ls_items_checked_at is distinct from s.finished_at);
  get diagnostics n = row_count;
  -- a vendor no longer tied to LS loses its counts
  update public.vendors set ls_active_items = null, ls_archived_items = null, ls_items_checked_at = null
   where organization_id = p_org and lightspeed_vendor_id is null and ls_items_checked_at is not null;
  return n;
end;
$$;
revoke execute on function public.ls_items_apply(uuid) from public, anon, authenticated;
grant execute on function public.ls_items_apply(uuid) to service_role;

-- A vendor tied to a different LS vendor ("In Lightspeed as") shows that one's counts at once.
create or replace function public.vendor_ls_counts()
returns trigger language plpgsql security definer set search_path = public as $$
declare l public.ls_vendors%rowtype;
begin
  if new.lightspeed_vendor_id is not distinct from old.lightspeed_vendor_id then return new; end if;
  select * into l from public.ls_vendors where organization_id = new.organization_id and ls_vendor_id = new.lightspeed_vendor_id;
  if new.lightspeed_vendor_id is null or l.active_items is null then
    new.ls_active_items := null; new.ls_archived_items := null; new.ls_items_checked_at := null;
  else
    new.ls_active_items := l.active_items; new.ls_archived_items := l.archived_items;
    new.ls_items_checked_at := (select finished_at from public.ls_item_scans where organization_id = new.organization_id);
  end if;
  return new;
end;
$$;
drop trigger if exists vendors_ls_counts on public.vendors;
create trigger vendors_ls_counts before update of lightspeed_vendor_id on public.vendors
  for each row execute function public.vendor_ls_counts();
