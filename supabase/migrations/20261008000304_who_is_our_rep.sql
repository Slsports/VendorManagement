-- 0304 — Who is our rep (Dana, Nov 3: "Why is Ted Morton not showing as our rep" — "If we are emailing back and forth with
--   someone that should generally peg them as our rep unless the emails have to do with shipping or customer service and
--   not an order being placed." — "go").
--   1. The WWD portal fills in what is missing on someone already on file (title, phones, the rep role): it used to skip
--      anyone whose address was there, so a person learned from email first never got WWD's details. Back-check: every
--      portal record on file.
--   2. The role check: everyone we have emailed back and forth with is read once (and again after new mail) by Claude in
--      contacts-learn. Talking about placing an order (prices, catalogs, quotes, the order, a PO) makes them a rep; only
--      shipping, only customer service or only billing gives that role instead. A vendor bought through a rep group keeps
--      the group's person as the rep (its own people are customer service). Typed contacts, ones the vendor confirmed and
--      the starred main rep are never changed; a WWD rep is never taken off. A vendor with no main rep and exactly one rep
--      gets that person as main rep. The email that showed it is kept on the contact (role_email_id).
set local lock_timeout = '5s';

alter table public.vendor_emails add column if not exists role_checked_at timestamptz;
alter table public.vendor_emails add column if not exists role_note text;
-- no foreign key on purpose: a second key to emails would make vendor_emails ↔ emails embeds ambiguous
alter table public.vendor_emails add column if not exists role_email_id uuid;
comment on column public.vendor_emails.role_checked_at is 'When Claude last read our back-and-forth with this person for their role (0304).';
comment on column public.vendor_emails.role_email_id is 'The email that showed their role (rep: the order talk), opened from the contact.';

-- 1. the portal fills in what is missing
create or replace function public.wwd_portal_contact_fill(p_vendor uuid, c jsonb, p_number text) returns boolean
language plpgsql security definer set search_path = public as $$
declare
  e      public.vendor_emails%rowtype;
  kind   public.contact_type;
  grp    uuid;
  v_roles public.contact_type[];
  n      integer;
begin
  select * into e from public.vendor_emails x where x.vendor_id = p_vendor and lower(x.email) = lower(c->>'email') limit 1;
  if e.id is null then return false; end if;
  begin kind := nullif(c->>'kind', '')::public.contact_type; exception when others then kind := null; end;
  select rep_group_id into grp from public.vendors where id = p_vendor;
  v_roles := e.roles;
  -- the role only for people VMS added itself and nobody confirmed; a rep group's vendor keeps the group's person as rep
  if kind is not null and e.source in ('email_enrichment', 'wwd_portal') and e.confirmed_at is null and e.kept_at is null
     and not (kind = any (e.roles)) and not (kind = 'rep' and grp is not null) then
    v_roles := array_remove(e.roles, 'other'::public.contact_type) || kind;
    if kind = 'rep' then v_roles := array_prepend('rep'::public.contact_type, array_remove(v_roles, 'rep'::public.contact_type)); end if;
  end if;
  update public.vendor_emails x set
         title = coalesce(x.title, nullif(trim(c->>'title'), '')),
         contact_name = coalesce(x.contact_name, nullif(trim(c->>'name'), '')),
         phones = case when jsonb_array_length(coalesce(x.phones, '[]'::jsonb)) = 0 and jsonb_typeof(c->'phones') = 'array' then c->'phones' else x.phones end,
         phone = coalesce(x.phone, c->'phones'->0->>'number'),
         roles = v_roles,
         contact_type = case when v_roles[1] is distinct from x.roles[1] then v_roles[1] else x.contact_type end,
         notes = case when coalesce(x.notes, '') ilike '%worldwide portal%' then x.notes
                      else concat_ws('. ', nullif(x.notes, ''), concat_ws(' ', 'Details from the Worldwide portal', '(#' || p_number || ')',
                             case when nullif(c->>'territory', '') is not null then 'territory ' || (c->>'territory') end)) end
   where x.id = e.id
     and (x.title is null and nullif(trim(c->>'title'), '') is not null
          or x.contact_name is null and nullif(trim(c->>'name'), '') is not null
          or jsonb_array_length(coalesce(x.phones, '[]'::jsonb)) = 0 and jsonb_array_length(coalesce(c->'phones', '[]'::jsonb)) > 0
          or v_roles is distinct from x.roles);
  get diagnostics n = row_count;
  return n > 0;
end;
$$;
revoke execute on function public.wwd_portal_contact_fill(uuid, jsonb, text) from public, anon, authenticated;
grant execute on function public.wwd_portal_contact_fill(uuid, jsonb, text) to service_role;

create or replace function public.wwd_portal_apply(p_id uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
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

  -- zero upcharge: the portal's answer is shown in the Worldwide portal box only. Dana, Oct 18: the show lists and rep
  -- sheets win over the WWD database ("Its very out of date"), so it never asks and never changes a vendor.

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
    -- already on file (learned from email first, like Ted Morton at Paricon): the portal fills in what is missing (0304)
    if exists (select 1 from public.vendor_emails e where e.vendor_id = v.id and lower(e.email) = v_email) then
      perform public.wwd_portal_contact_fill(v.id, c, w.number);
      continue;
    end if;
    -- removed stays removed (Dana, Oct 19): never add back someone deleted from this vendor or its rep group
    if exists (select 1 from public.contact_removals r where r.email = v_email and (r.vendor_id = v.id or (v.rep_group_id is not null and r.rep_group_id = v.rep_group_id))) then continue; end if;
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

-- 2. the role check
-- people to read: on a vendor, not typed or confirmed, not the starred main rep, with mail both ways (theirs and ours to
-- them) in Orders or shared mail; first time, or a non-rep with new mail since the last read. Their latest emails each.
create or replace function public.contact_role_queue(p_org uuid, p_limit integer default 6)
returns table(id uuid, email text, vendor_id uuid, company text, rep_group boolean, emails jsonb)
language sql stable security definer set search_path = public as $$
  with cand as (
    select x.id, lower(x.email) as em, x.vendor_id, x.role_checked_at, x.roles, v.name, v.rep_group_id is not null as rg
      from public.vendor_emails x join public.vendors v on v.id = x.vendor_id
     where x.organization_id = p_org and v.merged_into_id is null and x.former_at is null and x.email like '%@%'
       and x.source in ('email_enrichment', 'wwd_portal') and x.confirmed_at is null and x.kept_at is null
       and v.assigned_rep_contact_id is distinct from x.id
       and (x.role_checked_at is null or not ('rep' = any (x.roles)))
  ), mail as (
    select c.id, m.id as mid, m.direction, m.received_at, m.subject, m.from_name, m.body_text, m.snippet
      from cand c join public.emails m on m.organization_id = p_org and m.copy_of is null
       and ((m.direction = 'in' and lower(m.from_email) = c.em) or (m.direction = 'out' and (m.to_emails @> array[c.em] or m.cc_emails @> array[c.em])))
       and (m.mailbox_id is null or exists (select 1 from public.email_threads t where t.id = m.thread_id and t.shared_at is not null))
  ), ready as (
    select c.* from cand c
     where exists (select 1 from mail m where m.id = c.id and m.direction = 'in')
       and exists (select 1 from mail m where m.id = c.id and m.direction = 'out')
       and (c.role_checked_at is null or exists (select 1 from mail m where m.id = c.id and m.received_at > c.role_checked_at))
     order by c.role_checked_at nulls first
     limit greatest(1, least(coalesce(p_limit, 6), 20))
  )
  select r.id, r.em, r.vendor_id, r.name, r.rg,
         (select coalesce(jsonb_agg(z order by z.at desc), '[]'::jsonb) from (
            select m.mid as id, m.direction, m.received_at as at, m.subject, m.from_name, left(coalesce(m.body_text, m.snippet, ''), 1500) as text
              from mail m where m.id = r.id order by m.received_at desc limit 10) z)
    from ready r
$$;
revoke execute on function public.contact_role_queue(uuid, integer) from public, anon, authenticated;
grant execute on function public.contact_role_queue(uuid, integer) to service_role;

-- Claude's answer for one person: p_role rep | shipping | customer_service | ap | other
create or replace function public.contact_role_apply(p_id uuid, p_role text, p_email uuid, p_note text) returns text
language plpgsql security definer set search_path = public as $$
declare
  x      public.vendor_emails%rowtype;
  v      public.vendors%rowtype;
  role   public.contact_type;
  v_roles  public.contact_type[];
  result text;
  reps   uuid[];
begin
  select * into x from public.vendor_emails where id = p_id;
  if x.id is null then return 'gone'; end if;
  select * into v from public.vendors where id = x.vendor_id;
  role := case p_role when 'rep' then 'rep' when 'shipping' then 'shipping' when 'customer_service' then 'customer_service'
                      when 'ap' then 'ap' else 'other' end::public.contact_type;
  -- bought through a rep group: the vendor's own people are customer service (Dana, Oct 15)
  if role = 'rep' and v.rep_group_id is not null then role := 'customer_service'; end if;
  v_roles := x.roles;
  if role = 'rep' then
    v_roles := array_prepend('rep'::public.contact_type, array_remove(array_remove(v_roles, 'rep'::public.contact_type), 'other'::public.contact_type));
  elsif role <> 'other' then
    v_roles := array_remove(v_roles, 'other'::public.contact_type);
    -- a WWD rep is never taken off; one VMS guessed from a single email is
    if x.source <> 'wwd_portal' then v_roles := array_remove(v_roles, 'rep'::public.contact_type); end if;
    if not (role = any (v_roles)) then v_roles := v_roles || role; end if;
  end if;
  if coalesce(array_length(v_roles, 1), 0) = 0 then v_roles := array['other'::public.contact_type]; end if;
  result := case when v_roles = x.roles then 'same' when role = 'rep' then 'rep' else 'changed' end;
  update public.vendor_emails set roles = v_roles, contact_type = v_roles[1], role_checked_at = now(),
         role_note = left(nullif(trim(p_note), ''), 300), role_email_id = coalesce(p_email, role_email_id)
   where id = x.id;
  -- no main rep yet and exactly one rep: that person (never over a rep group or a starred rep)
  if v_roles[1] = 'rep' and v.rep_group_id is null and v.assigned_rep_contact_id is null and v.assigned_rep_group_contact_id is null then
    select array_agg(e.id) into reps from public.vendor_emails e where e.vendor_id = v.id and e.former_at is null and 'rep' = any (e.roles);
    if cardinality(reps) = 1 then
      update public.vendors set assigned_rep_contact_id = reps[1], updated_at = now() where id = v.id;
      result := 'main_rep';
    end if;
  end if;
  return result;
end;
$$;
revoke execute on function public.contact_role_apply(uuid, text, uuid, text) from public, anon, authenticated;
grant execute on function public.contact_role_apply(uuid, text, uuid, text) to service_role;

-- back-check of 1: every portal record's people already on file
do $$
declare w record; c jsonb; n integer := 0;
begin
  for w in select p.vendor_id, p.number, p.data from public.wwd_portal_vendors p join public.vendors v on v.id = p.vendor_id where v.merged_into_id is null loop
    for c in select * from jsonb_array_elements(coalesce(w.data->'contacts', '[]'::jsonb)) loop
      if nullif(c->>'email', '') is not null and public.wwd_portal_contact_fill(w.vendor_id, c, w.number) then n := n + 1; end if;
    end loop;
  end loop;
  raise notice 'portal fill-in: % contacts filled in', n;
end $$;
