-- 0300 — The freight company a paper names (Nov 3: a LaserVault paper can be WWD's "Distribution Center Freight Bill" for
--   XPO; it becomes a freight bill under XPO, like the XPO bills from Edenred).
set local lock_timeout = '5s';

create or replace function public.carrier_for_name(p_org uuid, p_name text) returns uuid
language sql stable security definer set search_path = public as $$
  select (array_agg(c.id))[1] from public.carriers c
   where c.organization_id = p_org and length(public.payee_key(p_name)) >= 3
     and (public.payee_key(split_part(c.name, ' (', 1)) = public.payee_key(p_name)
          or public.payee_key(c.name) like public.payee_key(p_name) || '%')
  having count(*) = 1
$$;
revoke execute on function public.carrier_for_name(uuid, text) from public, anon, authenticated;
grant execute on function public.carrier_for_name(uuid, text) to service_role;
