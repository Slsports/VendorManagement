-- 0217 — Delivery vendors' invoices are not checked against an order (Dana, Oct 20: "Yes you should"). Store delivery
-- vendors (Rod's Power Bait, Salter's, Mountain Milk, Brad's) drop goods with a paper invoice and have no order in VMS, so
-- every invoice of theirs became a "No order found" card in Needs a hand. Their invoices and credits are still filed
-- (and sent to Bill.com); no order check starts for a vendor ticked Delivery vendor.
-- Back-check: the four ticked; their open order checks set aside.

update public.vendors set is_delivery_vendor = true
 where merged_into_id is null and name in ('RODS POWER BAIT', 'SALTER''S DISTRIBUTING', 'MOUNTAIN MILK & CREAM', 'BRAD''S');

create or replace function public.order_check_from_document() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.kind not in ('confirmation', 'invoice') or new.storage_path is null then return new; end if;
  if exists (select 1 from public.vendors v where v.id = new.vendor_id and v.is_delivery_vendor) then return new; end if;
  insert into public.order_checks (organization_id, vendor_id, order_id, kind, document_id, email_id, assigned_to, assigned_at)
  values (new.organization_id, new.vendor_id, new.order_id, new.kind, new.id, new.email_id,
          case when new.order_id is not null then public.order_reviewer(new.order_id) end, case when new.order_id is not null then now() end)
  on conflict (document_id) do update set kind = excluded.kind, status = 'reading', reading = null, result = null
   where public.order_checks.kind <> excluded.kind and public.order_checks.status not in ('done', 'dismissed');
  return new;
end;
$$;

do $$
declare n int;
begin
  update public.order_checks c set status = 'dismissed'
    from public.vendors v
   where v.id = c.vendor_id and v.is_delivery_vendor and c.order_id is null and c.status not in ('done', 'dismissed');
  get diagnostics n = row_count;
  raise notice 'delivery vendors: % open order checks set aside', n;
end $$;
