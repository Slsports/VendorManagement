-- 0202 — Contacts keep their history; the WWD portal never outranks our own mail (Dana, Oct 19).
-- "The current email threads need to override the WWD vendor info", and "if we don't know the previous rep's name, it's
-- harder to search for them". Five rules, with former contacts:
--   1. Portal contacts start unconfirmed: from the WWD portal, not confirmed, until our mail backs them up.
--   2. Email confirms them: mail with that address about that vendor (filed to it, naming it or tagged with it) in the
--      last 24 months, or the vendor's own update form (confirmed_at), or Dana's Keep (kept_at).
--   3. Main rep comes from our mail: unconfirmed portal people and former contacts never show as Main rep; among the
--      vendor's own reps the one we wrote with most recently about it comes first (src/lib/contacts.ts).
--   4. Outdated portal contacts get a Review card, one per vendor (kind portal_contact): Keep, No longer their rep
--      (former), or Delete. The cards are the running list of outdated portal info for the WWD show.
--   5. Removed stays removed: a deleted contact leaves a contact_removals row; the portal import skips those, and
--      former contacts stay on file, so the import never adds them back either.
-- Former contacts (former_at) stay on the vendor page, folded, with the first and last time we emailed them, so old
-- mail can be found by name; they are never Main rep, never suggested when writing an email. Mail from them still
-- files to the vendor. Mail dates come from every mailbox but Accounting (Jarrett's old mail counts, Dana Oct 19);
-- only dates are kept, nothing from the mail itself. Refreshed hourly with the cards.

alter table public.vendor_emails add column if not exists former_at timestamptz;
alter table public.vendor_emails add column if not exists former_by uuid references public.profiles(id) on delete set null;
alter table public.vendor_emails add column if not exists kept_at timestamptz;
alter table public.vendor_emails add column if not exists first_mail_at timestamptz;
alter table public.vendor_emails add column if not exists last_mail_at timestamptz;
alter table public.vendor_emails add column if not exists last_vendor_mail_at timestamptz;
alter table public.rep_group_contacts add column if not exists former_at timestamptz;
alter table public.rep_group_contacts add column if not exists former_by uuid references public.profiles(id) on delete set null;
alter table public.rep_group_contacts add column if not exists first_mail_at timestamptz;
alter table public.rep_group_contacts add column if not exists last_mail_at timestamptz;

-- ---------- 5. removed stays removed ----------
create table if not exists public.contact_removals (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  vendor_id       uuid references public.vendors(id) on delete cascade,
  rep_group_id    uuid references public.rep_groups(id) on delete cascade,
  email           text not null check (email = lower(email)),
  removed_at      timestamptz not null default now(),
  removed_by      uuid references public.profiles(id) on delete set null,
  check ((vendor_id is null) <> (rep_group_id is null))
);
comment on table public.contact_removals is 'Contacts deleted from a vendor or rep group: imports never add them back.';
create unique index if not exists contact_removals_key on public.contact_removals (coalesce(vendor_id, rep_group_id), email);
alter table public.contact_removals enable row level security;
drop policy if exists "contact_removals: members read" on public.contact_removals;
create policy "contact_removals: members read" on public.contact_removals for select to authenticated using (public.user_in_org(organization_id));
grant select on table public.contact_removals to authenticated;
grant all on table public.contact_removals to service_role;

create or replace function public.contact_removed() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if old.email is null then return old; end if;
  -- the whole vendor or rep group going (a merge, a delete) is not a removal of the person
  if tg_table_name = 'vendor_emails' then
    if exists (select 1 from public.vendors where id = old.vendor_id) then
      insert into public.contact_removals (organization_id, vendor_id, email, removed_by)
      values (old.organization_id, old.vendor_id, lower(old.email), auth.uid()) on conflict do nothing;
    end if;
  elsif exists (select 1 from public.rep_groups where id = old.rep_group_id) then
    insert into public.contact_removals (organization_id, rep_group_id, email, removed_by)
    values (old.organization_id, old.rep_group_id, lower(old.email), auth.uid()) on conflict do nothing;
  end if;
  return old;
end;
$$;
drop trigger if exists vendor_emails_removed on public.vendor_emails;
create trigger vendor_emails_removed after delete on public.vendor_emails for each row execute function public.contact_removed();
drop trigger if exists rep_group_contacts_removed on public.rep_group_contacts;
create trigger rep_group_contacts_removed after delete on public.rep_group_contacts for each row execute function public.contact_removed();

-- Jeff Lipke, removed from World Famous Sports on Oct 19 before this existed
insert into public.contact_removals (organization_id, vendor_id, email)
select organization_id, id, 'jefflipke@comcast.net' from public.vendors where id = '55d9f1c1-856f-465b-a1da-bf8b3a057642'
on conflict do nothing;

-- ---------- the portal import skips removed people ----------
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

-- ---------- mail dates ----------
-- First and last email with each contact's address (any mailbox but Accounting), and the last one about that vendor.
create or replace function public.contacts_refresh_mail(p_org uuid)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare n_v integer; n_g integer;
begin
  with c as (
    select ve.id, ve.vendor_id, lower(ve.email) em from public.vendor_emails ve
     where ve.organization_id = p_org and ve.email is not null
  ), g as (
    select gc.id, lower(gc.email) em from public.rep_group_contacts gc
     where gc.organization_id = p_org and gc.email is not null
  ), m as (
    select e.received_at, lower(x) addr, array_remove(array[e.vendor_id] || e.mentioned_vendor_ids || t.tagged_vendor_ids, null) vids
      from public.emails e join public.email_threads t on t.id = e.thread_id
      left join public.mailboxes b on b.id = e.mailbox_id
      cross join lateral unnest(array[e.from_email] || e.to_emails || e.cc_emails) x
     where e.organization_id = p_org and coalesce(b.kind, 'orders') <> 'accounting'
       and lower(x) in (select em from c union select em from g)
  ), sv as (
    select c.id, min(m.received_at) f, max(m.received_at) l, max(m.received_at) filter (where c.vendor_id = any (m.vids)) lv
      from c join m on m.addr = c.em group by c.id
  )
  update public.vendor_emails ve set first_mail_at = sv.f, last_mail_at = sv.l, last_vendor_mail_at = sv.lv
    from sv where sv.id = ve.id
     and (ve.first_mail_at, ve.last_mail_at, ve.last_vendor_mail_at) is distinct from (sv.f, sv.l, sv.lv);
  get diagnostics n_v = row_count;
  with g as (
    select gc.id, lower(gc.email) em from public.rep_group_contacts gc where gc.organization_id = p_org and gc.email is not null
  ), m as (
    select e.received_at, lower(x) addr
      from public.emails e left join public.mailboxes b on b.id = e.mailbox_id
      cross join lateral unnest(array[e.from_email] || e.to_emails || e.cc_emails) x
     where e.organization_id = p_org and coalesce(b.kind, 'orders') <> 'accounting' and lower(x) in (select em from g)
  ), sg as (
    select g.id, min(m.received_at) f, max(m.received_at) l from g join m on m.addr = g.em group by g.id
  )
  update public.rep_group_contacts gc set first_mail_at = sg.f, last_mail_at = sg.l
    from sg where sg.id = gc.id and (gc.first_mail_at, gc.last_mail_at) is distinct from (sg.f, sg.l);
  get diagnostics n_g = row_count;
  return jsonb_build_object('vendor_contacts', n_v, 'rep_group_contacts', n_g);
end;
$$;
revoke execute on function public.contacts_refresh_mail(uuid) from public, anon, authenticated;
grant execute on function public.contacts_refresh_mail(uuid) to service_role;

-- ---------- 1-2. unconfirmed portal contacts ----------
create or replace function public.portal_contact_unconfirmed(ve public.vendor_emails) returns boolean
language sql stable set search_path = public as $$
  select ve.source = 'wwd_portal' and ve.former_at is null and ve.kept_at is null and ve.confirmed_at is null
     and coalesce(ve.last_vendor_mail_at, '-infinity') < now() - interval '24 months'
$$;

-- ---------- 4. one Review card per vendor with portal contacts to check ----------
create or replace function public.portal_contacts_review(p_org uuid)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare n_new integer; n_done integer;
begin
  insert into public.review_items (organization_id, kind, entity_type, entity_id, title, details)
  select v.organization_id, 'portal_contact', 'vendor', v.id,
         format('%s: %s WWD portal contact%s to check', v.name, count(*), case when count(*) = 1 then '' else 's' end),
         jsonb_build_object('vendor_id', v.id, 'vendor_name', v.name, 'vendor_id_for_rules', v.id)
    from public.vendor_emails ve join public.vendors v on v.id = ve.vendor_id and v.is_active
   where v.organization_id = p_org and public.portal_contact_unconfirmed(ve)
     and not exists (select 1 from public.review_items r where r.kind = 'portal_contact' and r.entity_id = v.id and r.status = 'pending')
   group by v.organization_id, v.id, v.name;
  get diagnostics n_new = row_count;
  update public.review_items r set status = 'accepted', resolved_at = now(), resolution_note = 'All checked'
   where r.organization_id = p_org and r.kind = 'portal_contact' and r.status = 'pending'
     and not exists (select 1 from public.vendor_emails ve where ve.vendor_id = r.entity_id and public.portal_contact_unconfirmed(ve));
  get diagnostics n_done = row_count;
  return jsonb_build_object('cards_new', n_new, 'cards_done', n_done);
end;
$$;
revoke execute on function public.portal_contacts_review(uuid) from public, anon, authenticated;
grant execute on function public.portal_contacts_review(uuid) to service_role;

-- ---------- Keep / No longer their rep / Current again / Delete ----------
create or replace function public.vendor_contact_set(p_id uuid, p_action text)
returns void
language plpgsql security definer set search_path = public as $$
declare v_vendor uuid; v_org uuid;
begin
  select vendor_id, organization_id into v_vendor, v_org from public.vendor_emails where id = p_id;
  if v_vendor is null or not public.user_in_org(v_org) or not public.user_can_edit() then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  if p_action = 'keep' then
    update public.vendor_emails set kept_at = now(), former_at = null, former_by = null where id = p_id;
  elsif p_action = 'former' then
    update public.vendor_emails set former_at = now(), former_by = auth.uid() where id = p_id and former_at is null;
    update public.vendors set assigned_rep_contact_id = null where assigned_rep_contact_id = p_id;
  elsif p_action = 'current' then
    update public.vendor_emails set former_at = null, former_by = null, kept_at = coalesce(kept_at, now()) where id = p_id;
  elsif p_action = 'delete' then
    delete from public.vendor_emails where id = p_id;
  else
    raise exception 'Unknown action %', p_action using errcode = '22023';
  end if;
  update public.review_items r set status = 'accepted', resolved_at = now(), resolved_by = auth.uid(), resolution_note = 'All checked'
   where r.kind = 'portal_contact' and r.entity_id = v_vendor and r.status = 'pending'
     and not exists (select 1 from public.vendor_emails ve where ve.vendor_id = v_vendor and public.portal_contact_unconfirmed(ve));
end;
$$;
revoke execute on function public.vendor_contact_set(uuid, text) from public, anon;
grant execute on function public.vendor_contact_set(uuid, text) to authenticated;

create or replace function public.rep_group_contact_set(p_id uuid, p_action text)
returns void
language plpgsql security definer set search_path = public as $$
declare v_org uuid;
begin
  select organization_id into v_org from public.rep_group_contacts where id = p_id;
  if v_org is null or not public.user_in_org(v_org) or not public.user_can_edit() then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  if p_action = 'former' then
    update public.rep_group_contacts set former_at = now(), former_by = auth.uid() where id = p_id and former_at is null;
    update public.vendors set assigned_rep_group_contact_id = null where assigned_rep_group_contact_id = p_id;
  elsif p_action = 'current' then
    update public.rep_group_contacts set former_at = null, former_by = null where id = p_id;
  else
    raise exception 'Unknown action %', p_action using errcode = '22023';
  end if;
end;
$$;
revoke execute on function public.rep_group_contact_set(uuid, text) from public, anon;
grant execute on function public.rep_group_contact_set(uuid, text) to authenticated;

-- a former contact is never the starred Main rep (also when former_at is set some other way)
create or replace function public.vendor_emails_former_unstar() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.former_at is not null and old.former_at is null then
    update public.vendors set assigned_rep_contact_id = null where assigned_rep_contact_id = new.id;
  end if;
  return new;
end;
$$;
drop trigger if exists vendor_emails_former_unstar on public.vendor_emails;
create trigger vendor_emails_former_unstar after update of former_at on public.vendor_emails for each row execute function public.vendor_emails_former_unstar();

-- ---------- hourly: mail dates, then the cards ----------
create or replace function public.contacts_hourly() returns void
language plpgsql security definer set search_path = public as $$
declare o record;
begin
  for o in select id from public.organizations loop
    perform public.contacts_refresh_mail(o.id);
    perform public.portal_contacts_review(o.id);
  end loop;
end;
$$;
revoke execute on function public.contacts_hourly() from public, anon, authenticated;
do $$
begin
  if exists (select 1 from pg_namespace where nspname = 'cron') then
    perform cron.unschedule(jobid) from cron.job where jobname = 'contacts-hourly';
    perform cron.schedule('contacts-hourly', '41 * * * *', 'select public.contacts_hourly()');
  end if;
end $$;

-- back-check now: every contact's mail dates, then the cards
select public.contacts_hourly();
