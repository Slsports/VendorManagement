-- 0284 — Freight shipments also find their order through the vendor's own email and papers (Dana, Nov 2): "Why didn't
-- that fix Coyote?? I found an email from Coyote that vms should have read listing the shipment of our order on Feb 25,
-- 2026 with tracking # UPS tracking # 1z546 070 03 4393 8112 listed" … "The invoice attached to that email had the po in it
-- that matches Hotshow2-1-26". The tracking was written with spaces (the search only found it whole), and the email was not
-- tied to an order, only its attached invoice was readable. New proof steps, before the date suggestion:
--   2b. the tracking number, spaces and dashes ignored, in the vendor's own email within 10 days before / 30 after the
--       ship date → that email's order, or the order a paper attached to it is filed on;
--   2c. a reference printed on the bill that is one of the vendor's invoice / confirmation numbers (Cal Mango "#48571")
--       → the order that paper is filed on;
--   2d. the vendor's one invoice dated the ship date (±1 day) filed on an order (Hot Fashions 8806, Bluestone 10000008,
--       Joy Linens 44882) → that order.
-- Each must point to exactly one order of that vendor; otherwise the line keeps only a suggestion.
set local lock_timeout = '5s';

create or replace function public.freight_line_proof(p_line uuid) returns uuid
language plpgsql stable security definer set search_path = public as $$
declare l public.freight_bill_lines%rowtype; v_vendor uuid; v_trk text; v_n integer; v_order uuid;
begin
  select * into l from public.freight_bill_lines where id = p_line;
  v_vendor := coalesce(l.vendor_id, l.suggested_vendor_id);
  if v_vendor is null or l.ship_date is null then return null; end if;
  -- 2b. tracking in the vendor's own email, however it is spaced
  v_trk := lower(regexp_replace(regexp_replace(coalesce(l.tracking[1], ''), 'A$', ''), '[^A-Za-z0-9]', '', 'g'));
  if length(v_trk) >= 8 then
    select count(distinct x.oid), min(x.oid::text)::uuid into v_n, v_order from (
      select coalesce(e.order_id, k.order_id) oid
        from public.emails e
        left join public.vendor_links k on k.email_id = e.id and k.order_id is not null
       where e.organization_id = l.organization_id and e.vendor_id = v_vendor
         and e.received_at between l.ship_date - 10 and l.ship_date + 30
         and lower(regexp_replace(coalesce(e.body_text, ''), '[^A-Za-z0-9]', '', 'g')) like '%' || v_trk || '%') x
     where x.oid is not null and exists (select 1 from public.orders o where o.id = x.oid and o.vendor_id = v_vendor and o.status <> 'cancelled');
    if v_n = 1 then return v_order; end if;
  end if;
  -- 2c. a printed reference that is one of the vendor's own paper numbers
  if cardinality(l.po_refs) > 0 then
    select count(distinct k.order_id), min(k.order_id::text)::uuid into v_n, v_order
      from public.vendor_links k join public.orders o on o.id = k.order_id and o.vendor_id = v_vendor and o.status <> 'cancelled'
     where k.vendor_id = v_vendor and k.doc_number is not null and length(public.freight_ref_key(k.doc_number)) >= 4
       and exists (select 1 from unnest(l.po_refs) r
                    where public.freight_ref_key(r) = public.freight_ref_key(k.doc_number)
                       or public.freight_ref_key(k.doc_number) like public.freight_ref_key(r) || '_'
                       or public.freight_ref_key(k.doc_number) like public.freight_ref_key(r) || '__');
    if v_n = 1 then return v_order; end if;
  end if;
  -- 2d. the vendor's one invoice dated the ship day, filed on an order
  select count(distinct k.order_id), min(k.order_id::text)::uuid into v_n, v_order
    from public.vendor_links k join public.orders o on o.id = k.order_id and o.vendor_id = v_vendor and o.status <> 'cancelled'
   where k.vendor_id = v_vendor and k.kind = 'invoice' and k.doc_date between l.ship_date - 1 and l.ship_date + 1;
  if v_n = 1 then return v_order; end if;
  return null;
end;
$$;
revoke execute on function public.freight_line_proof(uuid) from public, anon, authenticated;
grant execute on function public.freight_line_proof(uuid) to service_role;

-- freight_bill_loaded: the new proof runs after the printed PO and the tracking search, before the date suggestion.
do $$
declare src text;
begin
  select pg_get_functiondef('public.freight_bill_loaded(uuid)'::regprocedure) into src;
  if position('freight_line_proof' in src) = 0 then
    src := replace(src, '    -- 3. a suggestion: the vendor''s order placed closest before the ship date',
      '    -- 2b-2d. the vendor''s own email (tracking however spaced) and papers' || chr(10) ||
      '    v_order := public.freight_line_proof(l.id);' || chr(10) ||
      '    if v_order is not null then' || chr(10) ||
      '      update public.freight_bill_lines set order_id = v_order, vendor_id = (select vendor_id from public.orders where id = v_order), confirmed = true, confirmed_at = now() where id = l.id;' || chr(10) ||
      '      continue;' || chr(10) ||
      '    end if;' || chr(10) ||
      '    v_order := null;' || chr(10) ||
      '    -- 3. a suggestion: the vendor''s order placed closest before the ship date');
    if position('freight_line_proof' in src) = 0 then raise exception 'freight_bill_loaded did not take the new step'; end if;
    execute src;
  end if;
end $$;

-- Back-check: the open bills once more.
select public.freight_bill_loaded(id) from public.freight_bills where status = 'to_match';
