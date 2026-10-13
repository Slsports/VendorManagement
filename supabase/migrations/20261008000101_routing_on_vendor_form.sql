-- 0101 — The routing letter on the vendor's form (Dana, Oct 13: "It should ask if they received it with a yes or no").
-- When a routing letter exists, the confirmation form asks "Did you receive our routing instructions?" Yes marks the
-- current letter received for that person; No prepares the letter for them in Mail › Drafts (a fresh email when the
-- earlier one went out). The answer is kept on the confirmation.

alter table public.vendor_confirmations add column if not exists routing_answer text check (routing_answer in ('yes', 'no'));
alter table public.vendor_confirmations add column if not exists routing_answered_at timestamptz;

-- One routing-letter email for one person: the send row (date, name, email) and its draft. Internal: callers check rights.
create or replace function public.routing_send_prepare(p_letter uuid, p_vendor uuid, p_email text, p_name text, p_owner uuid, p_send uuid default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  l       public.routing_letters%rowtype;
  v_send  uuid := p_send;
  v_draft uuid;
  v_orders text;
  v_body  text;
  v_name  text;
  v_owner uuid;
begin
  select * into l from public.routing_letters where id = p_letter;
  if l.id is null then return null; end if;
  if v_send is null then
    insert into public.routing_letter_sends (organization_id, letter_id, vendor_id, contact_name, email)
    values (l.organization_id, l.id, p_vendor, p_name, lower(p_email))
    on conflict (letter_id, email) do nothing
    returning id into v_send;
    if v_send is null then return null; end if;
  end if;
  select name into v_name from public.vendors where id = p_vendor;
  v_owner := coalesce(p_owner, l.created_by, public.org_admin(l.organization_id));
  v_orders := public.routing_open_orders(p_vendor);
  v_body := replace(replace(replace(l.email_body,
    '{first_name}', coalesce(split_part(nullif(trim(p_name), ''), ' ', 1), 'there')),
    '{open_orders}', case when v_orders is null then '' else E'This applies to your open orders with us:\n' || v_orders || E'\n\nPlease send the freight quote and shipment details for these before they ship.\n' end),
    '{receipt_link}', 'https://vms.shaverlakesports.com/r/' || (select token from public.routing_letter_sends where id = v_send));
  v_body := regexp_replace(v_body, E'\n{3,}', E'\n\n', 'g');
  insert into public.email_drafts (organization_id, owner_id, created_by, to_emails, subject, body, vendor_id, note, routing_send_id)
  values (l.organization_id, v_owner, auth.uid(), array[lower(p_email)], l.email_subject, v_body, p_vendor,
          'Routing letter v' || l.version || ' for ' || coalesce(v_name, 'vendor') || ' (the letter is attached when it sends)', v_send)
  returning id into v_draft;
  update public.routing_letter_sends set draft_id = v_draft where id = v_send;
  return v_send;
end;
$$;
revoke execute on function public.routing_send_prepare(uuid, uuid, text, text, uuid, uuid) from public, anon, authenticated;
grant execute on function public.routing_send_prepare(uuid, uuid, text, text, uuid, uuid) to service_role;

-- The buttons on Freight › Routing letter, now through routing_send_prepare (same people as before).
create or replace function public.routing_letter_prepare(p_letter uuid, p_who text)
returns integer language plpgsql security definer set search_path = public as $$
declare
  l   public.routing_letters%rowtype;
  r   record;
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
    if public.routing_send_prepare(l.id, r.vendor_id, r.email, r.contact_name, auth.uid()) is not null then n := n + 1; end if;
  end loop;
  return n;
end;
$$;
revoke execute on function public.routing_letter_prepare(uuid, text) from public, anon;
grant execute on function public.routing_letter_prepare(uuid, text) to authenticated;

-- What the form shows about the routing letter: null when there is no letter yet.
create or replace function public.vendor_confirm_routing_state(p_confirmation uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  select case when l.id is null then null else jsonb_build_object(
           'version', l.version,
           'sent_at', s.sent_at,
           'received_at', s.received_at,
           'answer', c.routing_answer) end
    from public.vendor_confirmations c
    left join lateral (select * from public.routing_letters x where x.organization_id = c.organization_id order by x.version desc limit 1) l on true
    left join public.routing_letter_sends s on s.letter_id = l.id and s.email = lower(c.email)
   where c.id = p_confirmation
$$;
revoke execute on function public.vendor_confirm_routing_state(uuid) from public, anon, authenticated;
grant execute on function public.vendor_confirm_routing_state(uuid) to service_role;

-- Their answer (vendor-public, after the form is applied). Yes → received; No → the letter is prepared for them.
create or replace function public.vendor_confirm_routing(p_token uuid, p_answer text)
returns text language plpgsql security definer set search_path = public as $$
declare
  c  public.vendor_confirmations%rowtype;
  l  public.routing_letters%rowtype;
  s  public.routing_letter_sends%rowtype;
begin
  if p_answer not in ('yes', 'no') then return null; end if;
  select * into c from public.vendor_confirmations where token = p_token for update;
  if c.id is null then return null; end if;
  update public.vendor_confirmations set routing_answer = p_answer, routing_answered_at = now() where id = c.id;
  select * into l from public.routing_letters where organization_id = c.organization_id order by version desc limit 1;
  if l.id is null then return 'no_letter'; end if;
  select * into s from public.routing_letter_sends where letter_id = l.id and email = lower(c.email);
  if p_answer = 'yes' then
    if s.id is not null and s.sent_at is not null then
      update public.routing_letter_sends set received_at = coalesce(received_at, now()) where id = s.id;
      return 'received';
    end if;
    return 'noted';
  end if;
  -- No: a draft for them, unless one is already waiting in Drafts.
  if s.id is not null and exists (select 1 from public.email_drafts d where d.id = s.draft_id) then return 'waiting'; end if;
  perform public.routing_send_prepare(l.id, c.vendor_id, c.email, c.contact_name, c.sent_by, s.id);
  return 'prepared';
end;
$$;
revoke execute on function public.vendor_confirm_routing(uuid, text) from public, anon, authenticated;
grant execute on function public.vendor_confirm_routing(uuid, text) to service_role;

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
    'categories', coalesce((select jsonb_agg(k.category order by k.category) from public.vendor_sells k where k.vendor_id = v.id), '[]'::jsonb),
    'routing', public.vendor_confirm_routing_state(c.id)
  );
end;
$$;

