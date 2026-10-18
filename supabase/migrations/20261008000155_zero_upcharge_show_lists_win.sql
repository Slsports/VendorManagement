-- 155: zero upcharge, the show lists win over the WWD portal (Dana, Oct 18: "I would take the show docs over the wwd db.
-- Its very out of date. Move the ones from review if the WWD Database is the only thing confirming").
-- 1. The portal's zero upcharge no longer asks or marks anything; it stays visible in the vendor's Worldwide portal box.
-- 2. Cards taken out of the review queue (kept as VMS has it): the 8 where only the portal said zero upcharge (Cascade
--    Mountain Tech, Charbroil, Mykos-Lamo, Okuma, Primemotion, Rapala - Normark, Triple T, Troll Co) and the 4 where VMS's
--    zero upcharge came from a show list or Donna Hoffman's DandyLines sheet and only the portal said no (Crosman,
--    Gordini, Harry Koenig, Punita Group). Left for Dana: ALPS Mountaineering and Creative Group (a show list or Donna's
--    sheet names a related company as zero upcharge) and Odd Sox and Prairie Schooner (Donna's sheet says yes, the
--    Spring 2025/2026 show lists say no).
-- 3. 19 show-list lines whose "no" migration 150 overwrote with the portal's "yes" go back to the show list's answer
--    (Fall 2026: 7, Spring 2026: 10, Spring 2025: 2; found by the time 150 changed them).

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

update public.review_items r
   set status = 'rejected'::public.review_status, resolved_at = now(),
       resolution_note = 'Kept ours: the show lists win over the WWD portal (Dana, Oct 18)'
 where r.kind = 'portal_conflict' and r.status = 'pending' and r.details->>'field' = 'wwd_zero_upcharge'
   and r.details->>'vendor_name' in ('CASCADE MOUNTAIN TECH', 'CHARBROIL', 'MYKOS-LAMO', 'OKUMA', 'PRIMEMOTION', 'RAPALA - NORMARK',
                                     'TRIPLE T', 'TROLL CO', 'CROSMAN', 'GORDINI', 'HARRY KOENIG COMPANY', 'PUNITA GROUP INC');

update public.vendor_directory d set zero_upcharge = false
  from public.wwd_portal_vendors w
 where w.line_id = d.id and w.vendor_id is null and d.zero_upcharge
   and d.source in ('wwd_fall_2026', 'wwd_spring_2026', 'wwd_spring_2025')
   and d.updated_at >= '2026-10-17 16:38:00+00' and d.updated_at < '2026-10-17 16:39:00+00'
   and coalesce(w.data->'resources'->>'zero_upcharge', w.data->'resources'->>'rebate_program') = 'true';
