-- 0357 — Vendors who get no routing letter (Dana, Nov 12: "Take off all websites where we have no control over their
-- shipping: Ali Express, Amazon, Bassetts, Costco, Rods (he drops off the worms, no shipping), Scope, Talahi, Walmart, Web
-- Restaurant, All Faire vendors").
--   • vendors.no_routing_letter: the vendor form's "No routing letter" tick. Ticked now for the nine she named.
--   • Retail stores (the "Retail store" tick: Costco, Walmart, Amazon…) and vendors billed through Faire by default need no
--     tick: they never get the letter either, now or when added later.
--   • Left out of "Vendors with open orders and no email address" and of every Prepare emails on the Routing letter page.
set local lock_timeout = '5s';

alter table public.vendors add column if not exists no_routing_letter boolean not null default false;
comment on column public.vendors.no_routing_letter is 'No freight routing letter: we have no control over how they ship (websites, a local who drops off) (Dana, Nov 12).';

/** No routing letter for this vendor: ticked, a retail store, or billed through Faire by default. */
create or replace function public.vendor_skips_routing_letter(p_vendor uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select v.no_routing_letter or v.is_retail_store
                          or exists (select 1 from public.vendor_billing_routes r where r.vendor_id = v.id and r.route = 'faire' and r.is_default)
                     from public.vendors v where v.id = p_vendor), false)
$$;
revoke execute on function public.vendor_skips_routing_letter(uuid) from public, anon;
grant execute on function public.vendor_skips_routing_letter(uuid) to authenticated, service_role;

create or replace function public.routing_letter_missing(p_org uuid, p_who text)
returns table (vendor_id uuid, vendor_name text, open_orders integer)
language sql stable security definer set search_path = public as $$
  select v.id, v.name, (select count(*)::integer from public.orders o where o.vendor_id = v.id and o.status in ('open', 'awaiting_confirmation', 'confirmed'))
    from public.vendors v
   where v.organization_id = p_org and public.user_in_org(p_org) and v.is_active and v.merged_into_id is null and not v.web_orders and not v.no_freight and not public.vendor_skips_routing_letter(v.id)
     and case p_who when 'open_orders' then exists (select 1 from public.orders o where o.vendor_id = v.id and o.status in ('open', 'awaiting_confirmation', 'confirmed'))
                    when 'all' then exists (select 1 from public.orders o where o.vendor_id = v.id) else false end
     and not exists (select 1 from public.routing_recipients(v.id))
   order by v.name
$$;

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
       where v.organization_id = l.organization_id and v.is_active and v.merged_into_id is null and not v.web_orders and not public.vendor_skips_routing_letter(v.id)
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

grant execute on function public.routing_letter_missing(uuid, text) to authenticated;

update public.vendors set no_routing_letter = true
 where merged_into_id is null and not no_routing_letter
   and upper(name) in ('ALI EXPRESS', 'AMAZON', 'BASSETTS CRICKET RANCH', 'COSTCO', 'RODS POWER BAIT', 'SCOPE ENTERPRISES', 'TALAHI', 'WALMART', 'WEBSTAURANT STORE');
