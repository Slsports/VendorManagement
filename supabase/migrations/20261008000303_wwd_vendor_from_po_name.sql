-- 0303 — The PO-name rule (Dana, Nov 3: "can't we just have a rule that they look at the PO and if it matches a NAME of one
--   of our vendors it files it there?" — "go on PO-name rule"). Our POs are the vendor's name and the date ("LUXPRO82725").
--   A WWD invoice whose WWD name VMS does not know goes to the vendor its PO names: the PO without the date must be exactly one
--   vendor's name or alias. WWD's name goes first (Worldwide booth POs and Worldwide Buying Group drop-ships name the brand, not
--   who bills it); Worldwide itself is never picked by PO. WWD's name becomes that vendor's alias. Older POs that don't follow
--   the pattern stay in WWD names to match.
set local lock_timeout = '5s';

create or replace function public.wwd_relink(p_org uuid)
returns integer
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
  -- a freight company's name (XPO): the line is freight, filed to the company; its vendor comes from the
  -- delivery receipt with the same PRO number (the EdenRed "invoice number" on an XPO line is its PRO)
  update public.wwd_invoices i set carrier_id = m.cid, updated_at = now()
    from (select x.nm, public.wwd_carrier_for(p_org, x.nm) as cid
            from (select distinct wwd_vendor_name as nm from public.wwd_invoices
                   where organization_id = p_org and carrier_id is null and vendor_id is null and wwd_vendor_name is not null) x) m
   where i.organization_id = p_org and i.carrier_id is null and i.vendor_id is null and i.wwd_vendor_name = m.nm and m.cid is not null;
  update public.wwd_invoices i set vendor_id = d.vendor_id, vendor_set_by = 'auto', order_id = coalesce(i.order_id, d.order_id),
         order_set_by = case when i.order_id is null and d.order_id is not null then 'auto' else i.order_set_by end, updated_at = now()
    from public.delivery_receipts d
   where i.organization_id = p_org and i.carrier_id is not null and i.vendor_id is null and d.organization_id = p_org
     and d.carrier_id = i.carrier_id and d.vendor_id is not null
     and length(regexp_replace(coalesce(i.vendor_invoice_number, ''), '\D', '', 'g')) >= 6
     and regexp_replace(d.pro_number, '\D', '', 'g') = regexp_replace(i.vendor_invoice_number, '\D', '', 'g');
  -- our PO names exactly one order: that order's vendor
  update public.wwd_invoices i set vendor_id = o.vendor_id, vendor_set_by = 'auto', updated_at = now()
    from (select i2.id, (select (array_agg(o.vendor_id))[1] from public.orders o
                          where o.organization_id = p_org and public.po_key(o.po_number) = public.po_key(i2.po_number) having count(distinct o.vendor_id) = 1) as vendor_id
            from public.wwd_invoices i2 where i2.organization_id = p_org and i2.vendor_id is null and i2.vendor_set_by is distinct from 'person' and public.po_key(i2.po_number) is not null) o
   where o.id = i.id and o.vendor_id is not null;
  -- our PO starts with a vendor's name, the date dropped ("LUXPRO82725"): that vendor, when WWD's own name found none and
  -- exactly one vendor has that name (never Worldwide itself: its booth POs are billed by the real vendor). WWD's name becomes
  -- the vendor's alias so the next one matches by name (Dana, Nov 3, 0303).
  with c as (
    select i2.id, i2.wwd_vendor_name,
           (select (array_agg(distinct v.id))[1] from public.vendors v
             where v.organization_id = p_org and v.merged_into_id is null and v.id is distinct from v_self
               and exists (select 1 from unnest(array_append(v.aliases, v.name)) nm where public.payee_key(nm) = i2.pk)
            having count(distinct v.id) = 1) as vid
      from (select w.id, w.wwd_vendor_name, public.payee_key(regexp_replace(w.po_number, '[0-9][0-9 ./_#-]*[A-Za-z]?$', '')) as pk
              from public.wwd_invoices w
             where w.organization_id = p_org and w.vendor_id is null and w.carrier_id is null and w.vendor_set_by is distinct from 'person'
               and w.po_number ~ '[A-Za-z]{3}') i2
     where length(i2.pk) >= 4
  ), u as (
    update public.wwd_invoices i set vendor_id = c.vid, vendor_set_by = 'auto', updated_at = now()
      from c where c.id = i.id and c.vid is not null
    returning i.vendor_id, i.wwd_vendor_name
  )
  update public.vendors v set aliases = array_append(v.aliases, trim(a.nm))
    from (select distinct on (u.vendor_id) u.vendor_id, u.wwd_vendor_name as nm from u where nullif(trim(u.wwd_vendor_name), '') is not null) a
   where v.id = a.vendor_id
     and not exists (select 1 from unnest(array_append(v.aliases, v.name)) x where public.payee_key(x) = public.payee_key(a.nm));
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
  -- the vendor's own invoice number on a paper tied to an order (Dana, Oct 31: WFS bills the first shipment of SO 88198
  -- as I88198 and the later ones I88198-2, -3 …; Worldwide writes them I881982, I881983): that order
  update public.wwd_invoices i set order_id = o.oid, order_set_by = 'auto', updated_at = now()
    from (select i2.id, (select (array_agg(distinct l.order_id))[1] from public.vendor_links l
                          where l.vendor_id = i2.vendor_id and l.order_id is not null and l.kind = 'invoice' and l.doc_number is not null
                            and public.po_norm(l.doc_number) = public.po_norm(i2.vendor_invoice_number) having count(distinct l.order_id) = 1) as oid
            from public.wwd_invoices i2 where i2.organization_id = p_org and i2.order_id is null and i2.kind = 'invoice' and i2.vendor_id is not null
             and length(public.po_norm(i2.vendor_invoice_number)) >= 4) o
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

-- back-check: everything on file now
do $$
declare o record;
begin
  for o in select id from public.organizations loop perform public.wwd_relink(o.id); end loop;
end $$;
