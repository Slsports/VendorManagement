-- 0111 — Order emails from ordering services become orders (Dana, Oct 13: "go"). NuORDER, Faire, Elastic, MarketTime,
-- vendors' own web stores: the email saying our order was submitted or received. Gold Medal's $798 NuORDER order of
-- Feb 4 and the Mykos order of Sept 1 were in Mail but never orders. The sent-orders function reads them (12 months
-- back, then as they arrive): Claude reads the vendor, order number, total and items, and the vendor contact the email
-- names; VMS links it to the order on file or adds it, and saves the contact to the vendor's Reps & contacts.
-- Uses emails.order_scan like our sent orders; inbound emails only come through service_order_queue.

create index if not exists emails_service_order_scan_idx on public.emails (organization_id, received_at desc)
  where direction = 'in' and order_scan is null and copy_of is null;

-- The one active vendor with this name or other name (exact, then the start of exactly one name). Null when unsure.
create or replace function public.vendor_by_name(p_org uuid, p_name text)
returns uuid language sql stable security definer set search_path = public as $$
  with names as (
    select v.id, public.name_norm(x) as n from public.vendors v cross join lateral unnest(array[v.name] || v.aliases) x
     where v.organization_id = p_org and v.is_active and v.merged_into_id is null
  ), want as (select public.name_norm(p_name) as n)
  select coalesce(
    (select min(id::text)::uuid from names, want where names.n = want.n and want.n <> '' having count(distinct id) = 1),
    (select min(id::text)::uuid from names, want where length(want.n) >= 4 and (names.n like want.n || ' %' or want.n like names.n || ' %') having count(distinct id) = 1))
$$;

-- Emails that may be an ordering service telling us an order went in. Service role only.
create or replace function public.service_order_queue(p_org uuid, p_limit integer default 10)
returns table (email_id uuid)
language sql stable security definer set search_path = public as $$
  select e.id
    from public.emails e
    left join public.email_senders s on s.id = e.sender_id
   where e.organization_id = p_org and e.direction = 'in' and e.copy_of is null and e.order_scan is null
     and e.received_at > now() - interval '365 days'
     and coalesce(s.kind, 'unknown') not in ('marketing', 'not_vendor', 'internal', 'carrier')
     and lower(coalesce(e.from_email, '')) not like '%amazon.%'
     and coalesce(e.subject, '') !~* '^\s*re:'
     and coalesce(e.subject, '') ~* '(order|\mpo\M).{0,80}(submitted|received|placed|confirmed|final submission)|(new|your) order (has been |was )?(received|placed|confirmed|submitted)|order confirmation|thank(s| you) for (placing )?your order|new order received|order #?[0-9a-z-]+ confirmed'
     and coalesce(e.subject, '') !~* '(shipped|shipping|delivered|out for delivery|tracking|invoice|reorder|re-order|% off|sale\M|invitation|password|back ?order|cancel|return)'
     and not exists (select 1 from public.order_checks c where c.email_id = e.id)
   order by e.received_at
   limit p_limit
$$;

revoke execute on function public.vendor_by_name(uuid, text), public.service_order_queue(uuid, integer) from public, anon, authenticated;
grant execute on function public.vendor_by_name(uuid, text), public.service_order_queue(uuid, integer) to service_role;
