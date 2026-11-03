-- 0297 — The vendor a paper names, when exactly one vendor has that name or alias (Nov 3: LaserVault papers with no WWD
--   invoice number, like a vendor's credit memo with only WWD's receiving stamp, still go to that vendor's documents).
set local lock_timeout = '5s';

create or replace function public.vendor_for_name(p_org uuid, p_name text) returns uuid
language sql stable security definer set search_path = public as $$
  select (array_agg(v.id))[1] from public.vendors v
   where v.organization_id = p_org and v.merged_into_id is null and length(public.payee_key(p_name)) >= 3
     and (public.payee_key(v.name) = public.payee_key(p_name)
          or exists (select 1 from unnest(v.aliases) a where public.payee_key(a) = public.payee_key(p_name)))
  having count(*) = 1
$$;
revoke execute on function public.vendor_for_name(uuid, text) from public, anon, authenticated;
grant execute on function public.vendor_for_name(uuid, text) to service_role;
