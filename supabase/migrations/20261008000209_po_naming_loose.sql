-- 0209 — Our PO naming, as people really type it (Dana's back-check, Oct 20). Staff write the vendor part their own way
-- and drop leading zeros: LUXPRO9226, ATWOOD9226, Panthermrtn9126, LAZY9226, OKUMA9126. Those are ours. A PO fits our
-- naming when it is letters for the vendor followed by the date (4 to 6 digits); a bare number like 26569 does not.
create or replace function public.po_check_state(p_check uuid) returns text
language sql stable security definer set search_path = public as $$
  select case
    when not public.is_real_po(x.theirs) then 'missing'
    when public.is_real_po(x.ours) then case when strpos(public.po_norm(x.theirs), public.po_norm(x.ours)) > 0 then 'ours' else 'not_ours' end
    when public.po_norm(x.theirs) ~ '^[A-Z]{2,}[0-9]{4,6}' then 'fits'
    else 'off' end
  from (
    select coalesce(nullif(trim(c.po_number), ''), c.reading->>'po_number') as theirs, o.po_number as ours
      from public.order_checks c
      left join public.orders o on o.id = c.order_id
     where c.id = p_check
  ) x
$$;
revoke execute on function public.po_check_state(uuid) from public, anon;
grant execute on function public.po_check_state(uuid) to authenticated, service_role;
