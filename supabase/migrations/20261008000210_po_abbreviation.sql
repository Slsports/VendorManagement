-- 0210 — PO abbreviation on the vendor (Dana, Oct 20: "a field in the vendor record for PO naming conventions … WFS101526
-- or PLANET51026 … enter the abbreviation we want to use into the field and that's how Claude can create them").
-- vendors.po_code is that field (shown as "PO abbreviation"); our next PO is it + the order date. A confirmation's PO fits
-- our naming when it starts with the vendor's abbreviation; with none set, letters then the date, as before.
comment on column public.vendors.po_code is 'PO abbreviation: the vendor part of our PO numbers, PLANET in PLANET102026 (Dana, Oct 13 and Oct 20).';

create or replace function public.po_check_state(p_check uuid) returns text
language sql stable security definer set search_path = public as $$
  select case
    when not public.is_real_po(x.theirs) then 'missing'
    when public.is_real_po(x.ours) then case when strpos(public.po_norm(x.theirs), public.po_norm(x.ours)) > 0 then 'ours' else 'not_ours' end
    when public.po_norm(x.theirs) ~ (case when x.code is not null then '^' || public.po_norm(x.code) || '[0-9]{4,6}' else '^[A-Z]{2,}[0-9]{4,6}' end) then 'fits'
    else 'off' end
  from (
    select coalesce(nullif(trim(c.po_number), ''), c.reading->>'po_number') as theirs, o.po_number as ours, nullif(trim(v.po_code), '') as code
      from public.order_checks c
      left join public.orders o on o.id = c.order_id
      left join public.vendors v on v.id = c.vendor_id
     where c.id = p_check
  ) x
$$;
revoke execute on function public.po_check_state(uuid) from public, anon;
grant execute on function public.po_check_state(uuid) to authenticated, service_role;
