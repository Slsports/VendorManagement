-- 0118 — The freight routing letter (Dana, Oct 13): "It should say the date, name and email it was sent to. If we update the
-- freight routing letter it needs to go to all the vendors again to confirm receipt." Each version of the letter is kept;
-- every send records who it went to and when; the email carries an "I received the routing instructions" link (a public
-- page, no login) that marks it received; one reminder after 7 days. Emails are prepared as drafts in Mail › Drafts, one
-- per person, and go out only when someone sends them (Send all).

create table if not exists public.routing_letters (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  version         integer not null,
  storage_path    text not null,
  file_name       text not null,
  effective_on    date,
  note            text,
  email_subject   text not null default 'Updated freight routing instructions – Shaver Lake Sports',
  email_body      text not null,
  created_by      uuid references public.profiles(id) on delete set null,
  created_at      timestamptz not null default now(),
  unique (organization_id, version)
);
comment on table public.routing_letters is 'Each version of our freight routing letter (PDF in vendor-files) and the email that sends it. {first_name}, {open_orders} and {receipt_link} fill in per person.';
alter table public.routing_letters enable row level security;
drop policy if exists "routing_letters: members read" on public.routing_letters;
create policy "routing_letters: members read" on public.routing_letters for select to authenticated using (public.user_in_org(organization_id));
drop policy if exists "routing_letters: editors update" on public.routing_letters;
create policy "routing_letters: editors update" on public.routing_letters for update to authenticated
  using (public.user_in_org(organization_id) and public.user_can_edit()) with check (public.user_in_org(organization_id) and public.user_can_edit());
grant select, update on table public.routing_letters to authenticated;
grant all on table public.routing_letters to service_role;

create table if not exists public.routing_letter_sends (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  letter_id       uuid not null references public.routing_letters(id) on delete cascade,
  vendor_id       uuid not null references public.vendors(id) on delete cascade,
  contact_name    text,
  email           text not null check (email = lower(email)),
  token           uuid not null default gen_random_uuid() unique,
  draft_id        uuid references public.email_drafts(id) on delete set null,
  sent_at         timestamptz,
  sent_email_id   uuid references public.emails(id) on delete set null,
  sent_by         uuid references public.profiles(id) on delete set null,
  received_at     timestamptz,
  reminded_at     timestamptz,
  created_at      timestamptz not null default now(),
  unique (letter_id, email)
);
comment on table public.routing_letter_sends is 'Who each routing letter version went to (date, name, email) and when they confirmed receiving it.';
create index if not exists routing_letter_sends_vendor_idx on public.routing_letter_sends (vendor_id, created_at desc);
alter table public.routing_letter_sends enable row level security;
drop policy if exists "routing_letter_sends: members read" on public.routing_letter_sends;
create policy "routing_letter_sends: members read" on public.routing_letter_sends for select to authenticated using (public.user_in_org(organization_id));
grant select on table public.routing_letter_sends to authenticated;
grant all on table public.routing_letter_sends to service_role;

alter table public.email_drafts add column if not exists routing_send_id uuid references public.routing_letter_sends(id) on delete set null;

-- A new version of the letter (the PDF is uploaded first). Editors.
create or replace function public.routing_letter_add(p_org uuid, p_path text, p_file_name text, p_effective date, p_note text, p_subject text, p_body text)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  if not (public.user_in_org(p_org) and public.user_can_edit()) then raise exception 'Only admins, managers and buyers change the routing letter' using errcode = '42501'; end if;
  if split_part(p_path, '/', 1) <> p_org::text then raise exception 'File not found' using errcode = '23503'; end if;
  insert into public.routing_letters (organization_id, version, storage_path, file_name, effective_on, note, email_subject, email_body, created_by)
  values (p_org, coalesce((select max(version) from public.routing_letters where organization_id = p_org), 0) + 1, p_path, p_file_name, p_effective,
          nullif(trim(coalesce(p_note, '')), ''), coalesce(nullif(trim(coalesce(p_subject, '')), ''), 'Updated freight routing instructions – Shaver Lake Sports'), p_body, auth.uid())
  returning id into v_id;
  return v_id;
end;
$$;
revoke execute on function public.routing_letter_add(uuid, text, text, date, text, text, text) from public, anon;
grant execute on function public.routing_letter_add(uuid, text, text, date, text, text, text) to authenticated;

-- A vendor's open orders as lines for the email ("- PO 1234, placed 9/2/26, $544.56").
create or replace function public.routing_open_orders(p_vendor uuid)
returns text language sql stable security definer set search_path = public as $$
  select string_agg('- ' || concat_ws(', ', coalesce('PO ' || nullif(o.po_number, ''), 'Order'),
                    case when o.order_date is not null then 'placed ' || to_char(o.order_date, 'FMMM/FMDD/YY') end,
                    case when coalesce(o.est_cost, o.final_cost) is not null then to_char(coalesce(o.est_cost, o.final_cost), 'FM$999,999,990.00') end), E'\n' order by o.order_date nulls last)
    from public.orders o
   where o.vendor_id = p_vendor and o.status in ('open', 'awaiting_confirmation', 'confirmed')
$$;

-- Who a vendor's routing letter goes to: its orders, shipping and rep contacts, else the vendor's own email.
create or replace function public.routing_recipients(p_vendor uuid)
returns table (email text, contact_name text)
language sql stable security definer set search_path = public as $$
  with c as (
    select distinct on (lower(ve.email)) lower(ve.email) as email, ve.contact_name
      from public.vendor_emails ve
     where ve.vendor_id = p_vendor and ve.email is not null and ve.roles && array['orders', 'shipping', 'rep']::public.contact_type[]
       and ve.email !~* '(no-?reply|do-?not-?reply|notification)'
     order by lower(ve.email), ve.contact_name nulls last
  )
  select email, contact_name from c
  union all
  select lower(v.email), null from public.vendors v where v.id = p_vendor and v.email is not null and not exists (select 1 from c)
$$;

-- Prepare the emails as drafts: 'open_orders' = vendors with orders placed and not shipped; 'previous' = everyone who got
-- an earlier version; 'all' = every vendor we buy from. Returns how many drafts; vendors with no address are listed by
-- routing_letter_missing. Web-order vendors (Kelli's) are left out.
create or replace function public.routing_letter_prepare(p_letter uuid, p_who text)
returns integer language plpgsql security definer set search_path = public as $$
declare
  l   public.routing_letters%rowtype;
  r   record;
  v_send uuid;
  v_draft uuid;
  v_orders text;
  v_body text;
  n   integer := 0;
begin
  select * into l from public.routing_letters where id = p_letter;
  if l.id is null or not (public.user_in_org(l.organization_id) and public.user_can_edit()) then raise exception 'Letter not found' using errcode = '23503'; end if;
  for r in
    with vendors as (
      select v.id, v.name from public.vendors v
       where v.organization_id = l.organization_id and v.is_active and v.merged_into_id is null and not v.web_orders
         and case p_who
               when 'open_orders' then exists (select 1 from public.orders o where o.vendor_id = v.id and o.status in ('open', 'awaiting_confirmation', 'confirmed'))
               when 'previous' then exists (select 1 from public.routing_letter_sends s join public.routing_letters x on x.id = s.letter_id where s.vendor_id = v.id and x.organization_id = l.organization_id and x.version < l.version and s.sent_at is not null)
               when 'all' then exists (select 1 from public.orders o where o.vendor_id = v.id)
               else false end
    )
    select vd.id as vendor_id, vd.name, rc.email, rc.contact_name
      from vendors vd
      cross join lateral (
        select p.email, p.contact_name from public.routing_recipients(vd.id) p where p_who <> 'previous'
        union
        select s.email, s.contact_name from public.routing_letter_sends s join public.routing_letters x on x.id = s.letter_id
         where p_who = 'previous' and s.vendor_id = vd.id and x.version < l.version and s.sent_at is not null
      ) rc
     where not exists (select 1 from public.routing_letter_sends s where s.letter_id = l.id and s.email = rc.email)
  loop
    insert into public.routing_letter_sends (organization_id, letter_id, vendor_id, contact_name, email)
    values (l.organization_id, l.id, r.vendor_id, r.contact_name, r.email)
    on conflict (letter_id, email) do nothing
    returning id into v_send;
    continue when v_send is null;
    v_orders := public.routing_open_orders(r.vendor_id);
    v_body := replace(replace(replace(l.email_body,
      '{first_name}', coalesce(split_part(nullif(trim(r.contact_name), ''), ' ', 1), 'there')),
      '{open_orders}', case when v_orders is null then '' else E'This applies to your open orders with us:\n' || v_orders || E'\n\nPlease send the freight quote and shipment details for these before they ship.\n' end),
      '{receipt_link}', 'https://vms.shaverlakesports.com/r/' || (select token from public.routing_letter_sends where id = v_send));
    v_body := regexp_replace(v_body, E'\n{3,}', E'\n\n', 'g');
    insert into public.email_drafts (organization_id, owner_id, created_by, to_emails, subject, body, vendor_id, note, routing_send_id)
    values (l.organization_id, auth.uid(), auth.uid(), array[r.email], l.email_subject, v_body, r.vendor_id,
            'Routing letter v' || l.version || ' for ' || r.name || ' (the letter is attached when it sends)', v_send)
    returning id into v_draft;
    update public.routing_letter_sends set draft_id = v_draft where id = v_send;
    n := n + 1;
  end loop;
  return n;
end;
$$;
revoke execute on function public.routing_letter_prepare(uuid, text) from public, anon;
grant execute on function public.routing_letter_prepare(uuid, text) to authenticated;

-- Vendors that would get the letter but have no email address on file.
create or replace function public.routing_letter_missing(p_org uuid, p_who text)
returns table (vendor_id uuid, vendor_name text, open_orders integer)
language sql stable security definer set search_path = public as $$
  select v.id, v.name, (select count(*)::integer from public.orders o where o.vendor_id = v.id and o.status in ('open', 'awaiting_confirmation', 'confirmed'))
    from public.vendors v
   where v.organization_id = p_org and public.user_in_org(p_org) and v.is_active and v.merged_into_id is null and not v.web_orders
     and case p_who when 'open_orders' then exists (select 1 from public.orders o where o.vendor_id = v.id and o.status in ('open', 'awaiting_confirmation', 'confirmed'))
                    when 'all' then exists (select 1 from public.orders o where o.vendor_id = v.id) else false end
     and not exists (select 1 from public.routing_recipients(v.id))
   order by v.name
$$;
revoke execute on function public.routing_letter_missing(uuid, text) from public, anon;
grant execute on function public.routing_letter_missing(uuid, text) to authenticated;

-- gmail-send stamps the send once the email is out.
create or replace function public.routing_letter_mark_sent(p_send uuid, p_email uuid, p_by uuid)
returns void language sql security definer set search_path = public as $$
  update public.routing_letter_sends set sent_at = coalesce(sent_at, now()), sent_email_id = coalesce(sent_email_id, p_email), sent_by = coalesce(sent_by, p_by) where id = p_send
$$;

-- The public "I received it" page (vendor-public function). Returns the letter to show; marks it received.
create or replace function public.routing_receipt(p_token uuid)
returns table (vendor_name text, version integer, storage_path text, file_name text, received_at timestamptz)
language plpgsql security definer set search_path = public as $$
begin
  update public.routing_letter_sends rs set received_at = coalesce(rs.received_at, now()) where rs.token = p_token and rs.sent_at is not null;
  return query
    select v.name, l.version, l.storage_path, l.file_name, s.received_at
      from public.routing_letter_sends s join public.routing_letters l on l.id = s.letter_id join public.vendors v on v.id = s.vendor_id
     where s.token = p_token;
end;
$$;

-- Reminders: sent 7 days ago or more, not confirmed, not reminded yet.
create or replace function public.routing_reminder_queue(p_limit integer default 20)
returns table (send_id uuid, organization_id uuid, email text, contact_name text, vendor_name text, token uuid, subject text, sent_by uuid)
language sql stable security definer set search_path = public as $$
  select s.id, s.organization_id, s.email, s.contact_name, v.name, s.token, l.email_subject, coalesce(s.sent_by, l.created_by)
    from public.routing_letter_sends s join public.routing_letters l on l.id = s.letter_id join public.vendors v on v.id = s.vendor_id
   where s.sent_at < now() - interval '7 days' and s.received_at is null and s.reminded_at is null
   order by s.sent_at
   limit p_limit
$$;

revoke execute on function public.routing_letter_mark_sent(uuid, uuid, uuid), public.routing_receipt(uuid), public.routing_reminder_queue(integer), public.routing_open_orders(uuid), public.routing_recipients(uuid) from public, anon, authenticated;
grant execute on function public.routing_letter_mark_sent(uuid, uuid, uuid), public.routing_receipt(uuid), public.routing_reminder_queue(integer), public.routing_open_orders(uuid), public.routing_recipients(uuid) to service_role;
