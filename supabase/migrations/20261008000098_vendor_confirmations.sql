-- 0119 — Vendors confirm their own info (Dana, Oct 13): "an auto email to go to every contact we import to let them know we
-- received their contact info from wwd and to please confirm their data and have them fill out our form that updates
-- directly to vms and marks them as 'confirmed'." One email per person (prepared in Mail › Drafts, Send all) with a link
-- to a form, no login: their details and phones; the company and coworkers; who gets POs, freight quotes and invoices;
-- how they take orders (email, phone, NuORDER, website); minimum order and any freight programs; other vendors they
-- represent (one per box); the product categories they sell. "Looks good" or "Submit changes" → Confirmed with the date.
-- Changes land directly, except a new company name (Review queue) and vendors VMS does not know (Review queue).
-- One reminder after 7 days; bounced emails mark the address bad; re-confirm once a year.

alter table public.vendor_emails add column if not exists confirmed_at timestamptz;
alter table public.vendor_emails add column if not exists bad_email_at timestamptz;
comment on column public.vendor_emails.confirmed_at is 'The person confirmed their details on our vendor form (Dana, Oct 13).';
comment on column public.vendor_emails.bad_email_at is 'An email to this address bounced.';

alter table public.vendors add column if not exists order_methods text[] not null default '{}';
alter table public.vendors add column if not exists freight_programs_vendor text;
alter table public.vendors add column if not exists info_confirmed_at timestamptz;
comment on column public.vendors.order_methods is 'How they take orders, from their form: email, phone, nuorder, website.';
comment on column public.vendors.freight_programs_vendor is 'Their freight programs in their own words, from their form.';

-- What a vendor sells: from the WWD portal, the vendor's own form, or typed.
create table if not exists public.vendor_sells (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  vendor_id       uuid not null references public.vendors(id) on delete cascade,
  category        text not null check (length(trim(category)) > 0),
  source          text not null default 'manual' check (source in ('wwd', 'vendor_form', 'manual')),
  confirmed_at    timestamptz,
  created_at      timestamptz not null default now()
);
create unique index if not exists vendor_sells_key on public.vendor_sells (vendor_id, lower(category));
alter table public.vendor_sells enable row level security;
drop policy if exists "vendor_sells: members read" on public.vendor_sells;
create policy "vendor_sells: members read" on public.vendor_sells for select to authenticated using (public.user_in_org(organization_id));
drop policy if exists "vendor_sells: editors write" on public.vendor_sells;
create policy "vendor_sells: editors write" on public.vendor_sells for all to authenticated
  using (public.user_in_org(organization_id) and public.user_can_edit()) with check (public.user_in_org(organization_id) and public.user_can_edit());
grant select, insert, update, delete on table public.vendor_sells to authenticated;
grant all on table public.vendor_sells to service_role;

alter table public.organizations add column if not exists confirm_email_subject text not null default 'Please confirm your contact info – Shaver Lake Sports';
alter table public.organizations add column if not exists confirm_email_body text not null default E'Hi {first_name},\n\nWe''ve updated our vendor records with your contact information from Worldwide. Please take 2 minutes to confirm it''s correct:\n\n{form_link}\n\nIf it''s all correct, just click Looks good. Otherwise fix what''s wrong and submit.\n\nThank you!';

create table if not exists public.vendor_confirmations (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  vendor_id       uuid not null references public.vendors(id) on delete cascade,
  vendor_email_id uuid references public.vendor_emails(id) on delete set null,
  email           text not null check (email = lower(email)),
  contact_name    text,
  token           uuid not null default gen_random_uuid() unique,
  draft_id        uuid references public.email_drafts(id) on delete set null,
  sent_at         timestamptz,
  sent_email_id   uuid references public.emails(id) on delete set null,
  sent_by         uuid references public.profiles(id) on delete set null,
  opened_at       timestamptz,
  confirmed_at    timestamptz,
  changed         boolean,
  reminded_at     timestamptz,
  bounced_at      timestamptz,
  created_at      timestamptz not null default now()
);
comment on table public.vendor_confirmations is 'Each "please confirm your contact info" email: who, when sent, opened, confirmed (with or without changes), reminded, bounced.';
create unique index if not exists vendor_confirmations_open on public.vendor_confirmations (vendor_id, email) where confirmed_at is null and bounced_at is null;
create index if not exists vendor_confirmations_vendor_idx on public.vendor_confirmations (vendor_id, created_at desc);
alter table public.vendor_confirmations enable row level security;
drop policy if exists "vendor_confirmations: members read" on public.vendor_confirmations;
create policy "vendor_confirmations: members read" on public.vendor_confirmations for select to authenticated using (public.user_in_org(organization_id));
grant select on table public.vendor_confirmations to authenticated;
grant all on table public.vendor_confirmations to service_role;

alter table public.email_drafts add column if not exists confirmation_id uuid references public.vendor_confirmations(id) on delete set null;

-- Prepare the emails (Mail › Drafts, one per person): everyone with an email at vendors we buy from (or one vendor), not
-- confirmed in the last 12 months, no bad address, nothing already waiting. Web-order vendors too: their info matters.
create or replace function public.vendor_confirm_prepare(p_org uuid, p_vendor uuid default null)
returns integer language plpgsql security definer set search_path = public as $$
declare
  r record;
  o public.organizations%rowtype;
  v_id uuid;
  v_draft uuid;
  n integer := 0;
begin
  if not (public.user_in_org(p_org) and public.user_can_edit()) then raise exception 'Only admins, managers and buyers send these' using errcode = '42501'; end if;
  select * into o from public.organizations where id = p_org;
  for r in
    select distinct on (ve.vendor_id, lower(ve.email)) ve.id, ve.vendor_id, lower(ve.email) as email, ve.contact_name, v.name as vendor_name
      from public.vendor_emails ve join public.vendors v on v.id = ve.vendor_id
     where v.organization_id = p_org and v.is_active and v.merged_into_id is null
       and (p_vendor is null or v.id = p_vendor)
       and (p_vendor is not null or exists (select 1 from public.orders x where x.vendor_id = v.id))
       and ve.email is not null and ve.bad_email_at is null
       and ve.email !~* '(no-?reply|do-?not-?reply|notification|mailer-daemon)'
       and (ve.confirmed_at is null or ve.confirmed_at < now() - interval '365 days')
       and not exists (select 1 from public.vendor_confirmations c where c.vendor_id = v.id and c.email = lower(ve.email) and c.confirmed_at is null and c.bounced_at is null)
     order by ve.vendor_id, lower(ve.email), ve.created_at
  loop
    insert into public.vendor_confirmations (organization_id, vendor_id, vendor_email_id, email, contact_name)
    values (p_org, r.vendor_id, r.id, r.email, r.contact_name)
    on conflict do nothing
    returning id into v_id;
    continue when v_id is null;
    insert into public.email_drafts (organization_id, owner_id, created_by, to_emails, subject, body, vendor_id, note, confirmation_id)
    values (p_org, auth.uid(), auth.uid(), array[r.email], o.confirm_email_subject,
            replace(replace(o.confirm_email_body, '{first_name}', coalesce(split_part(nullif(trim(r.contact_name), ''), ' ', 1), 'there')),
                    '{form_link}', 'https://vms.shaverlakesports.com/confirm/' || (select token from public.vendor_confirmations where id = v_id)),
            r.vendor_id, 'Contact confirmation for ' || r.vendor_name, v_id)
    returning id into v_draft;
    update public.vendor_confirmations set draft_id = v_draft where id = v_id;
    n := n + 1;
  end loop;
  return n;
end;
$$;
revoke execute on function public.vendor_confirm_prepare(uuid, uuid) from public, anon;
grant execute on function public.vendor_confirm_prepare(uuid, uuid) to authenticated;

create or replace function public.vendor_confirm_mark_sent(p_id uuid, p_email uuid, p_by uuid)
returns void language sql security definer set search_path = public as $$
  update public.vendor_confirmations set sent_at = coalesce(sent_at, now()), sent_email_id = coalesce(sent_email_id, p_email), sent_by = coalesce(sent_by, p_by) where id = p_id
$$;

-- The form's data for one link (vendor-public). Marks it opened.
create or replace function public.vendor_confirm_get(p_token uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  c public.vendor_confirmations%rowtype;
  v public.vendors%rowtype;
begin
  select * into c from public.vendor_confirmations where token = p_token;
  if c.id is null then return null; end if;
  update public.vendor_confirmations set opened_at = coalesce(opened_at, now()) where id = c.id;
  select * into v from public.vendors where id = c.vendor_id;
  return jsonb_build_object(
    'confirmed_at', c.confirmed_at,
    'me_id', c.vendor_email_id,
    'company', jsonb_build_object('name', v.name, 'address', v.address, 'city', v.city, 'state', v.state, 'postal_code', v.postal_code, 'phone', v.phone, 'website', v.website),
    'people', coalesce((select jsonb_agg(jsonb_build_object('id', e.id, 'name', e.contact_name, 'title', e.title, 'email', e.email, 'phones', e.phones, 'roles', e.roles) order by (e.id = c.vendor_email_id) desc, e.contact_name nulls last)
                          from public.vendor_emails e where e.vendor_id = v.id and e.email !~* '(no-?reply|do-?not-?reply|notification)'), '[]'::jsonb),
    'order_methods', to_jsonb(v.order_methods),
    'minimum_order', v.minimum_order,
    'freight_programs', coalesce(v.freight_programs_vendor, v.freight_program),
    'categories', coalesce((select jsonb_agg(k.category order by k.category) from public.vendor_sells k where k.vendor_id = v.id), '[]'::jsonb)
  );
end;
$$;

-- Apply the form (vendor-public). p_payload: me {name,title,email,phones,roles}; company {...}; people [{id?,name,title,
-- email,phones,remove?}]; po_to / quotes_to / invoices_to {id | name+email}; order_methods []; minimum_order;
-- freight_programs; represents [names]; categories [names]. p_looks_good: nothing changed, just confirm.
create or replace function public.vendor_confirm_submit(p_token uuid, p_payload jsonb, p_looks_good boolean)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  c   public.vendor_confirmations%rowtype;
  v   public.vendors%rowtype;
  me  jsonb := coalesce(p_payload->'me', '{}'::jsonb);
  co  jsonb := coalesce(p_payload->'company', '{}'::jsonb);
  p   jsonb;
  x   text;
  v_id uuid;
  v_match uuid;
  v_me uuid;
  unknown text[] := '{}';
begin
  select * into c from public.vendor_confirmations where token = p_token for update;
  if c.id is null then return null; end if;
  select * into v from public.vendors where id = c.vendor_id;
  v_me := c.vendor_email_id;

  if not p_looks_good then
    -- their own details
    if v_me is not null then
      update public.vendor_emails set
        contact_name = coalesce(nullif(trim(me->>'name'), ''), contact_name),
        title = nullif(trim(coalesce(me->>'title', '')), ''),
        phones = coalesce(me->'phones', phones),
        roles = case when jsonb_typeof(me->'roles') = 'array' and jsonb_array_length(me->'roles') > 0
                     then (select array_agg(distinct r::public.contact_type) from jsonb_array_elements_text(me->'roles') r where r in ('rep', 'orders', 'ap', 'customer_service', 'shipping', 'owner', 'other')) else roles end,
        email = case when lower(trim(coalesce(me->>'email', ''))) ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'
                      and not exists (select 1 from public.vendor_emails z where z.vendor_id = c.vendor_id and lower(z.email) = lower(trim(me->>'email')) and z.id <> v_me)
                     then lower(trim(me->>'email')) else email end
       where id = v_me;
    end if;
    -- the company: a new name goes to Dana; the rest lands
    update public.vendors set
      address = coalesce(nullif(trim(co->>'address'), ''), address), city = coalesce(nullif(trim(co->>'city'), ''), city),
      state = coalesce(nullif(trim(co->>'state'), ''), state), postal_code = coalesce(nullif(trim(co->>'postal_code'), ''), postal_code),
      phone = coalesce(nullif(trim(co->>'phone'), ''), phone), website = coalesce(nullif(trim(co->>'website'), ''), website),
      order_methods = case when jsonb_typeof(p_payload->'order_methods') = 'array' then (select coalesce(array_agg(m), '{}') from jsonb_array_elements_text(p_payload->'order_methods') m where m in ('email', 'phone', 'nuorder', 'website')) else order_methods end,
      minimum_order = coalesce(nullif(trim(p_payload->>'minimum_order'), ''), minimum_order),
      freight_programs_vendor = coalesce(nullif(trim(p_payload->>'freight_programs'), ''), freight_programs_vendor)
     where id = v.id;
    if nullif(trim(co->>'name'), '') is not null and lower(trim(co->>'name')) <> lower(v.name) then
      insert into public.review_items (organization_id, kind, entity_type, entity_id, title, details)
      values (v.organization_id, 'vendor_rename', 'vendor', v.id, v.name || ': new company name from their form',
              jsonb_build_object('new_name', trim(co->>'name'), 'reason', coalesce(c.contact_name, c.email) || ' wrote it on our contact form'));
    end if;
    -- coworkers: changes, new people, and people who are gone
    for p in select * from jsonb_array_elements(coalesce(p_payload->'people', '[]'::jsonb)) loop
      if (p->>'id') is not null and (p->>'id') <> coalesce(v_me::text, '') then
        if coalesce((p->>'remove')::boolean, false) then
          update public.vendors set assigned_rep_contact_id = null where id = v.id and assigned_rep_contact_id = (p->>'id')::uuid;
          delete from public.vendor_emails where id = (p->>'id')::uuid and vendor_id = v.id;
        else
          update public.vendor_emails set contact_name = coalesce(nullif(trim(p->>'name'), ''), contact_name), title = coalesce(nullif(trim(p->>'title'), ''), title),
                 phones = case when jsonb_typeof(p->'phones') = 'array' and jsonb_array_length(p->'phones') > 0 then p->'phones' else phones end
           where id = (p->>'id')::uuid and vendor_id = v.id;
        end if;
      elsif (p->>'id') is null and lower(trim(coalesce(p->>'email', ''))) ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
        insert into public.vendor_emails (organization_id, vendor_id, email, contact_name, title, phones, contact_type, roles, source, notes)
        values (v.organization_id, v.id, lower(trim(p->>'email')), nullif(trim(p->>'name'), ''), nullif(trim(p->>'title'), ''), coalesce(p->'phones', '[]'::jsonb),
                'other', '{other}', 'vendor_form', 'Added by ' || coalesce(c.contact_name, c.email) || ' on our contact form')
        on conflict do nothing;
      end if;
    end loop;
    -- who gets our POs, freight quotes and tracking, invoices
    perform public.vendor_confirm_role(v, c, p_payload->'po_to', 'orders');
    perform public.vendor_confirm_role(v, c, p_payload->'quotes_to', 'shipping');
    perform public.vendor_confirm_role(v, c, p_payload->'invoices_to', 'ap');
    -- other vendors they represent: known ones get this person as a rep, the rest go to Dana
    for x in select trim(t) from jsonb_array_elements_text(coalesce(p_payload->'represents', '[]'::jsonb)) t where length(trim(t)) > 1 loop
      v_match := public.vendor_by_name(v.organization_id, x);
      if v_match is not null and v_match <> v.id then
        insert into public.vendor_emails (organization_id, vendor_id, email, contact_name, title, phones, contact_type, roles, source, notes, confirmed_at)
        select v.organization_id, v_match, e.email, e.contact_name, e.title, e.phones, 'rep', '{rep}', 'vendor_form', 'Rep for ' || x || ' (from their contact form)', now()
          from public.vendor_emails e where e.id = v_me
        on conflict do nothing;
      elsif v_match is null then
        unknown := unknown || x;
      end if;
    end loop;
    if array_length(unknown, 1) > 0 then
      insert into public.review_items (organization_id, kind, entity_type, entity_id, title, details)
      values (v.organization_id, 'vendor_form', 'vendor', v.id, coalesce(c.contact_name, c.email) || ' (' || v.name || ') also represents vendors not in VMS',
              jsonb_build_object('reason', 'From their contact form: ' || array_to_string(unknown, ', '), 'represents', to_jsonb(unknown), 'email', c.email));
    end if;
    -- what they sell
    if jsonb_typeof(p_payload->'categories') = 'array' then
      delete from public.vendor_sells k where k.vendor_id = v.id
         and not exists (select 1 from jsonb_array_elements_text(p_payload->'categories') t where lower(trim(t)) = lower(k.category));
      insert into public.vendor_sells (organization_id, vendor_id, category, source, confirmed_at)
      select v.organization_id, v.id, trim(t), 'vendor_form', now() from jsonb_array_elements_text(p_payload->'categories') t where length(trim(t)) > 0
      on conflict (vendor_id, lower(category)) do update set confirmed_at = now();
    end if;
  end if;

  update public.vendor_emails set confirmed_at = now(), bad_email_at = null where id = v_me;
  update public.vendor_sells set confirmed_at = now() where vendor_id = v.id;
  update public.vendors set info_confirmed_at = now() where id = v.id;
  update public.vendor_confirmations set confirmed_at = now(), changed = not p_looks_good where id = c.id;
  return jsonb_build_object('vendor', v.name, 'freight_programs', p_payload->>'freight_programs', 'vendor_id', v.id);
end;
$$;

-- One of "who should receive our POs / freight quotes / invoices": an existing person (id) or someone new (name + email).
create or replace function public.vendor_confirm_role(v public.vendors, c public.vendor_confirmations, p_who jsonb, p_role public.contact_type)
returns void language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  if p_who is null or jsonb_typeof(p_who) <> 'object' then return; end if;
  if (p_who->>'id') is not null then
    v_id := (p_who->>'id')::uuid;
  elsif lower(trim(coalesce(p_who->>'email', ''))) ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    select id into v_id from public.vendor_emails where vendor_id = v.id and lower(email) = lower(trim(p_who->>'email'));
    if v_id is null then
      insert into public.vendor_emails (organization_id, vendor_id, email, contact_name, contact_type, roles, source, notes)
      values (v.organization_id, v.id, lower(trim(p_who->>'email')), nullif(trim(p_who->>'name'), ''), p_role, array[p_role], 'vendor_form',
              'Added by ' || coalesce(c.contact_name, c.email) || ' on our contact form')
      returning id into v_id;
    end if;
  end if;
  if v_id is not null then
    update public.vendor_emails set roles = (select array_agg(distinct r) from unnest(roles || p_role) r) where id = v_id and vendor_id = v.id;
  end if;
end;
$$;

-- Reminders: sent a week ago, not confirmed, not reminded, not bounced.
create or replace function public.vendor_confirm_reminder_queue(p_limit integer default 20)
returns table (id uuid, organization_id uuid, email text, contact_name text, vendor_name text, token uuid, sent_by uuid)
language sql stable security definer set search_path = public as $$
  select c.id, c.organization_id, c.email, c.contact_name, v.name, c.token, c.sent_by
    from public.vendor_confirmations c join public.vendors v on v.id = c.vendor_id
   where c.sent_at < now() - interval '7 days' and c.confirmed_at is null and c.reminded_at is null and c.bounced_at is null
   order by c.sent_at limit p_limit
$$;

-- Bounces: a "delivery failed" email naming an address we sent a confirmation or routing letter to marks it bad.
create or replace function public.emails_mark_bounces() returns trigger
language plpgsql security definer set search_path = public as $$
declare a text;
begin
  if new.direction = 'in' and lower(coalesce(new.from_email, '')) ~ '^(mailer-daemon|postmaster)@' then
    for a in select distinct lower(m[1]) from regexp_matches(coalesce(new.body_text, '') || ' ' || coalesce(new.snippet, ''), '([A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,})', 'g') m loop
      update public.vendor_confirmations set bounced_at = coalesce(bounced_at, now())
       where organization_id = new.organization_id and email = a and sent_at is not null and confirmed_at is null;
      if found then
        update public.vendor_emails set bad_email_at = coalesce(bad_email_at, now()) where lower(email) = a and organization_id = new.organization_id;
      end if;
    end loop;
  end if;
  return new;
end;
$$;
drop trigger if exists emails_mark_bounces on public.emails;
create trigger emails_mark_bounces after insert on public.emails for each row execute function public.emails_mark_bounces();

-- Each vendor's confirmation state, for the vendor list filter: confirmed / waiting / no answer / bad email / not asked.
create or replace function public.vendor_confirm_states(p_org uuid)
returns table (vendor_id uuid, state text, last_sent timestamptz, confirmed_at timestamptz)
language sql stable security definer set search_path = public as $$
  select v.id,
         case when v.info_confirmed_at > now() - interval '365 days' then 'confirmed'
              when bool_or(c.bounced_at is not null and c.confirmed_at is null) and not bool_or(c.bounced_at is null and c.confirmed_at is null and c.sent_at is not null) then 'bad_email'
              when bool_or(c.sent_at is not null and c.confirmed_at is null and c.sent_at > now() - interval '7 days') then 'waiting'
              when bool_or(c.sent_at is not null and c.confirmed_at is null) then 'no_answer'
              else 'not_asked' end,
         max(c.sent_at), v.info_confirmed_at
    from public.vendors v left join public.vendor_confirmations c on c.vendor_id = v.id
   where v.organization_id = p_org and public.user_in_org(p_org)
   group by v.id, v.info_confirmed_at
$$;

revoke execute on function public.vendor_confirm_mark_sent(uuid, uuid, uuid), public.vendor_confirm_get(uuid), public.vendor_confirm_submit(uuid, jsonb, boolean),
  public.vendor_confirm_role(public.vendors, public.vendor_confirmations, jsonb, public.contact_type), public.vendor_confirm_reminder_queue(integer) from public, anon, authenticated;
grant execute on function public.vendor_confirm_mark_sent(uuid, uuid, uuid), public.vendor_confirm_get(uuid), public.vendor_confirm_submit(uuid, jsonb, boolean),
  public.vendor_confirm_role(public.vendors, public.vendor_confirmations, jsonb, public.contact_type), public.vendor_confirm_reminder_queue(integer) to service_role;
revoke execute on function public.vendor_confirm_states(uuid) from public, anon;
grant execute on function public.vendor_confirm_states(uuid) to authenticated, service_role;
