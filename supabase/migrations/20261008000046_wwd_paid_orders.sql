-- 0067 — WWD invoices tie to orders already marked paid on the sheet too (Oct 9, first load): the vendor's only
-- order for exactly that amount (estimate or final cost) with no other WWD invoice. Old orders then show the
-- WWD invoice, the payment number and any freight-allowance credit (Water Sports' $579.25 on 7/26/24).
create or replace function public.wwd_relink(p_org uuid) returns integer
language plpgsql security definer set search_path = public as $$
declare
  v_self uuid := public.wwd_self_vendor(p_org);
  n      integer;
begin
  -- paid so far, from the payment lines
  update public.wwd_invoices i set paid_amount = s.amt, paid_date = s.last, updated_at = now()
    from (select l.invoice_id, sum(l.amount) as amt, max(p.pay_date) as last from public.wwd_payment_lines l join public.wwd_payments p on p.id = l.payment_id group by l.invoice_id) s
   where s.invoice_id = i.id and i.organization_id = p_org and (i.paid_amount is distinct from s.amt or i.paid_date is distinct from s.last);
  -- vendors: by name, the fee, then the invoice a credit or debit adjusts
  -- (each spelling is looked up once; an invoice placed automatically keeps its vendor unless the name changes)
  update public.wwd_invoices i set vendor_id = v_self, vendor_set_by = 'auto', updated_at = now()
   where i.organization_id = p_org and i.kind = 'fee' and i.vendor_id is null and v_self is not null;
  update public.wwd_invoices i set vendor_id = m.vid, vendor_set_by = 'auto', updated_at = now()
    from (select x.nm, public.wwd_vendor_for(p_org, x.nm) as vid
            from (select distinct wwd_vendor_name as nm from public.wwd_invoices
                   where organization_id = p_org and vendor_id is null and wwd_vendor_name is not null and vendor_set_by is distinct from 'person') x) m
   where i.organization_id = p_org and i.vendor_id is null and i.wwd_vendor_name = m.nm and m.vid is not null and i.vendor_set_by is distinct from 'person';
  -- our PO names exactly one order: that order's vendor
  update public.wwd_invoices i set vendor_id = o.vendor_id, vendor_set_by = 'auto', updated_at = now()
    from (select i2.id, (select (array_agg(o.vendor_id))[1] from public.orders o
                          where o.organization_id = p_org and public.po_key(o.po_number) = public.po_key(i2.po_number) having count(distinct o.vendor_id) = 1) as vendor_id
            from public.wwd_invoices i2 where i2.organization_id = p_org and i2.vendor_id is null and i2.vendor_set_by is distinct from 'person' and public.po_key(i2.po_number) is not null) o
   where o.id = i.id and o.vendor_id is not null;
  update public.wwd_invoices i set vendor_id = src.vendor_id, vendor_set_by = 'auto', updated_at = now()
    from public.wwd_invoices src
   where i.organization_id = p_org and i.kind in ('credit', 'debit') and i.vendor_id is null
     and src.organization_id = p_org and src.seq = i.seq and src.kind = 'invoice' and src.vendor_id is not null;
  -- orders: our PO with that vendor, else the vendor's only unpaid order for that amount
  update public.wwd_invoices i set order_id = o.oid, order_set_by = 'auto', updated_at = now()
    from (select i2.id, (select (array_agg(o.id))[1] from public.orders o
                          where o.vendor_id = i2.vendor_id and public.po_key(o.po_number) = public.po_key(i2.po_number) having count(*) = 1) as oid
            from public.wwd_invoices i2 where i2.organization_id = p_org and i2.order_id is null and i2.kind = 'invoice' and i2.vendor_id is not null and public.po_key(i2.po_number) is not null) o
   where o.id = i.id and o.oid is not null;
  update public.wwd_invoices i set order_id = o.oid, order_set_by = 'auto', updated_at = now()
    from (select i2.id, (select (array_agg(o.id))[1] from public.orders o
                          where o.vendor_id = i2.vendor_id and o.status <> 'cancelled' and i2.amount in (o.final_cost, o.est_cost)
                            and not exists (select 1 from public.wwd_invoices x where x.order_id = o.id) having count(*) = 1) as oid
            from public.wwd_invoices i2 where i2.organization_id = p_org and i2.order_id is null and i2.kind = 'invoice' and i2.vendor_id is not null and i2.amount is not null) o
   where o.id = i.id and o.oid is not null;
  update public.wwd_invoices i set order_id = src.order_id, order_set_by = 'auto', updated_at = now()
    from public.wwd_invoices src
   where i.organization_id = p_org and i.kind in ('credit', 'debit') and i.order_id is null
     and src.organization_id = p_org and src.seq = i.seq and src.kind = 'invoice' and src.order_id is not null and src.vendor_id is not distinct from i.vendor_id;
  -- a credit on an order with a freight allowance: the allowance came through
  update public.orders o set freight_allowance_received = c.d
    from (select order_id, min(coalesce(wwd_date, paid_date)) as d from public.wwd_invoices where organization_id = p_org and kind = 'credit' and order_id is not null group by order_id) c
   where c.order_id = o.id and o.freight_allowance_offered and o.freight_allowance_received is null and c.d is not null;
  -- orders whose WWD invoices are all paid
  with paid as (
    select i.order_id, max(coalesce(i.paid_date, i.sheet_paid_date)) as d,
           string_agg(distinct p.ref, ', ') filter (where p.ref is not null) as refs
      from public.wwd_invoices i
      left join public.wwd_payment_lines l on l.invoice_id = i.id
      left join public.wwd_payments p on p.id = l.payment_id
     where i.organization_id = p_org and i.order_id is not null and i.kind = 'invoice'
     group by i.order_id
    having bool_and(i.paid_date is not null or i.sheet_paid_date is not null)
  )
  update public.orders o set paid_date = paid.d, paid_via = coalesce(o.paid_via, 'wwd'), paid_ref = coalesce(o.paid_ref, paid.refs),
         status = case when o.status in ('entered', 'ready_to_pay', 'received') then 'paid'::public.order_status else o.status end
    from paid where paid.order_id = o.id and o.paid_date is null and paid.d is not null;
  get diagnostics n = row_count;
  return n;
end;
$$;

revoke execute on function public.wwd_relink(uuid) from public, anon, authenticated;
grant execute on function public.wwd_relink(uuid) to service_role;
