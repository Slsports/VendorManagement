-- 0273 — Dana, Oct 31 ("go on all 5, and yes remind me Monday"), World Famous SO 88198:
--   1. The routing company's FedEx Ground $375.87 (Gissell's "ORDER READY TO SHIP PO#WFS24236"; Gissell's reply in the
--      SO 88198 conversation, "I already sent routing through partnership", ties it) goes on the SO 88198 order.
--   2. That order takes WFS's PO WFS2426 (on the SO-88198 confirmation and on Worldwide's invoices; VMS had "I88198",
--      the first invoice number from the Placed Order Summary). The confirmation is read: S88198, Feb 28, $44,116.78.
--   3. Worldwide's invoices tie to an order by the vendor's own invoice number on a paper already tied to it, dash or no
--      dash (WFS: I88198, then I88198-2, -3 for the backorders; Worldwide writes I881982). wwd_relink runs.
--   4. Back-read: the 2026 confirmations the old six-month rule had filed unread (38, plus the one invoice on an open
--      order) were read for their PO, number, date and total only (no comparison, no emails, no cards). The numbers fill
--      blanks; a paper ties to an order only when exactly one of that vendor's orders has its PO. Becker's Sales Order
--      199889 (PO BECKER-1-13-26), left on the rep group, goes to Becker.
--   5. (freight-quotes) A PO one character off ("WFS24236" for WFS2426) matches only when it is the only close one.
--   A reminder for Dana, Monday Nov 2 at 9 AM: has World Famous said when the backorders ship?
--   WFS knowledge (Dana): an order is split when part is needed now: a ship-now order and a ship-later order (usually
--   April of the next year for summer-show orders, October for winter-show orders); backorders ship as the same SO with
--   -2, -3 …

set local lock_timeout = '5s';

do $$
declare
  o   constant uuid := '1bcae7f1-9507-4a6f-b536-d8168c1ef022';
  wfs constant uuid := '55d9f1c1-856f-465b-a1da-bf8b3a057642';
  org uuid;
  dana uuid;
begin
  select organization_id into org from public.orders where id = o and vendor_id = wfs;
  if org is null then return; end if;
  -- 2. their PO
  update public.orders set po_number = 'WFS2426', po_auto = false, est_cost = 44116.78,
         notes = concat_ws(E'\n', nullif(notes, ''),
           'PO changed from I88198 (WFS''s first invoice number, from the Placed Order Summary) to their WFS2426 on 10/31/2026: it is on the SO 88198 confirmation and Worldwide''s invoices; the order is shipping (Dana, Oct 31).',
           'SO 88198, Feb 28, 2026: $44,116.78. Shipped so far as invoices I88198, I88198-2, -3, -4; backorders still to come (Maria''s Oct 27 sheet).')
   where id = o and po_number = 'I88198';
  update public.vendor_links set doc_number = coalesce(doc_number, 'S88198'), doc_po = coalesce(doc_po, 'WFS2426'), doc_date = coalesce(doc_date, date '2026-02-28'), doc_total = coalesce(doc_total, 44116.78)
   where id = '9375f8d6-7194-49ea-b81d-02c47653862c';
  -- 1. the FedEx price and the routing emails
  update public.freight_quotes set order_id = o, vendor_id = wfs, match_how = 'conversation' where id::text like 'b8fdd18d%' and order_id is null;
  update public.freight_quotes set order_id = o where id::text in (select id::text from public.freight_quotes where id::text like '2b9edf7c%' or id::text like '6ce3107e%') and order_id is null;
  update public.emails set order_id = o where order_id is null and subject ilike '%WFS24236%';
  update public.orders set freight_cost = coalesce(freight_cost, 375.87),
         freight_notes = concat_ws(E'\n', nullif(freight_notes, ''), 'FedEx Ground $375.87 for the shipment World Famous had ready Oct 28 (routing request PO#WFS24236), approved by Dana Oct 28.')
   where id = o;
  -- reminder, Monday 9 AM
  dana := public.org_admin(org);
  insert into public.tasks (organization_id, title, notes, due_date, remind_at, assigned_to, vendor_id, order_id, thread_id, auto_key)
  select org, 'World Famous: when do the SO 88198 backorders ship?',
         'You asked Maria on Oct 28 when the backorders will ship; Gissell only answered about the routing. Click to open the conversation.',
         date '2026-11-02', (date '2026-11-02' + time '09:00') at time zone 'America/Los_Angeles', dana, wfs, o,
         (select thread_id from public.emails where id = '57e57a7b-bde3-4c9d-b0ee-efb35a6789bb'), 'wfs_bo_ask:88198'
  on conflict (organization_id, auto_key) where auto_key is not null do nothing;
  -- WFS's way of splitting orders, on the vendor
  update public.vendors set notes = concat_ws(E'\n', nullif(notes, ''),
           'Orders (Dana, Oct 31): winter and summer lines, ordered twice a year. When part of a show order is needed right away they split it: a ship-now order and a ship-later order (usually April of the next year for summer-show orders, October for winter-show orders). Backorders ship as the same SO with -2, -3 … (invoices I88198, I88198-2 …).')
   where id = wfs and coalesce(notes, '') not like '%ship-now order and a ship-later order%';
end $$;

-- 4. the skipped 2026 confirmations: their numbers, and the order when exactly one has that PO
update public.vendor_links set vendor_id = '8f4dfd21-50b8-48d6-8b27-45a23fefaade', rep_group_id = null
 where vendor_id is null and label ilike '%Sales Order 199889%' and rep_group_id = (select id from public.rep_groups where name = 'Manufacturers Exchange');
with r(id, doc_type, po, num, dt, tot) as (values
('84e2c5d7-db6b-4f6b-a2b0-e7bad26b7874'::uuid, 'confirmation', 'ARCADE2426', 'SO317043', '2026-02-13'::date, 257.4::numeric),
('0ad618b5-01a8-4b87-9b78-3c1c5aa3ee9f'::uuid, 'other', null, null, null::date, null::numeric),
('c6ee94d3-f8fe-4cd8-a0be-0f4cefdf06d1'::uuid, 'other', null, null, '2026-01-23'::date, null::numeric),
('30388eb7-0468-40c5-a889-e2881dd58fdf'::uuid, 'other', null, null, null::date, null::numeric),
('123935b8-f6e5-4635-8525-a81b95d677c3'::uuid, 'confirmation', '8671273', '8671273', '2026-02-05'::date, 2688::numeric),
('976046b3-656f-4e95-a7ba-9ce03d6026b5'::uuid, 'confirmation', 'AOB2-3-26', 'S000524826', '2026-02-05'::date, 275.76::numeric),
('6a318418-4727-43a2-bd3a-b48545d5fbfb'::uuid, 'invoice', '2425IMPLUS', 'INV04009802', '2025-02-13'::date, 415.26::numeric),
('c0aaf87e-306f-47d9-92cc-e57aa0accd8f'::uuid, 'confirmation', 'LG2770233', null, '2026-02-02'::date, 601.5::numeric),
('3aac6ca6-6c77-4cba-a2dd-b532f0cc4aa7'::uuid, 'confirmation', 'WEXTEXP4/1/2026', null, '2026-04-13'::date, 1634.05::numeric),
('c4c60d06-7e63-49d5-bda1-4de3c8679f23'::uuid, 'confirmation', 'FOREMOSTARP2.3.26', null, null::date, 461.2::numeric),
('76e99eb5-d96c-4a7c-bb54-06577da61e49'::uuid, 'invoice', 'IMP242026', 'INV04705696', '2026-02-16'::date, 447.48::numeric),
('ce7f4213-429e-484a-af2e-297d3c28b146'::uuid, 'confirmation', '8671273', '8671273', '2026-02-05'::date, 2688::numeric),
('014c3a88-d4a0-4466-b2b6-99bf5a18d4b4'::uuid, 'confirmation', null, 'S87727', '2026-02-12'::date, 2095.2::numeric),
('41843a42-08ac-4744-abb9-ccaa136448f6'::uuid, 'confirmation', 'Stansport 082725 REVISED', null, '2026-02-06'::date, 2586.2::numeric),
('49d1d7db-0f77-4b75-b4e3-4fc2b5a210f8'::uuid, 'confirmation', 'PUNITA2326', '30636500', '2026-02-22'::date, 733.8::numeric),
('d63256cb-694c-42a9-b57b-1026598745f2'::uuid, 'confirmation', 'LG2770233', '30464128', '2026-02-02'::date, 601.5::numeric),
('fe4b1f63-65e0-4633-b2a3-17e0ae7e29fc'::uuid, 'confirmation', 'PRIARIESCHOONER2326', null, '2026-02-13'::date, 824.48::numeric),
('512a470b-32c3-4237-9193-6cb481b5c4a9'::uuid, 'confirmation', 'LG7857597', null, '2026-03-10'::date, 1322.36::numeric),
('ddcb0fd8-f436-49ce-acff-e5ad2dd40177'::uuid, 'confirmation', 'FroggToggsWW21126', 'SO-1267590', '2026-02-12'::date, 1685.58::numeric),
('dbca05b8-606e-4b0a-9461-74f6b31ebc88'::uuid, 'confirmation', 'DANA031026', null, '2026-03-10'::date, 1542.41::numeric),
('ba20cf8f-beb4-48b4-b94d-a4859a720171'::uuid, 'confirmation', 'BECKER-1-13-26', '199889', '2026-01-14'::date, 9789::numeric),
('2afb7b9d-bca9-40da-9a65-7faf54839356'::uuid, 'confirmation', 'SCHYLLING2126', 'SO-541990', '2026-02-04'::date, 775.5::numeric),
('3a9559f5-8b6b-4a88-85fd-8715fd8d8115'::uuid, 'confirmation', 'RUKO020326', null, '2026-02-02'::date, 915.97::numeric),
('90818b9c-546e-4127-a30a-7efcaeec375a'::uuid, 'confirmation', '2232026SLS', '4078787-00', '2026-02-24'::date, 1181::numeric),
('6a9e29e6-47e1-434b-884b-4d46b52d9f8c'::uuid, 'confirmation', 'LG7857597', '30547183', '2026-03-10'::date, 1322.36::numeric),
('2a1ff510-54fb-4802-a0e9-58af32691401'::uuid, 'confirmation', null, null, '2026-02-02'::date, 952.18::numeric),
('5d563d23-f1d5-42b3-93f1-50fa0792f321'::uuid, 'confirmation', 'fss', '706152', '2026-01-20'::date, 1324.2::numeric),
('9e9a392e-028f-49a7-9bb7-613a456893ab'::uuid, 'confirmation', '082625_WW', 'S189502, S189501, S189498, S189496, S189494, S189492, S189491, S189490', '2025-09-10'::date, 4580.4::numeric),
('0b73bdec-3a6d-41f6-a9cc-23eec42b75c4'::uuid, 'confirmation', 'SPR2026', '4078795-00', '2026-02-24'::date, 4119.12::numeric),
('66f9e43d-6d28-433b-9a2c-e4c8fe700910'::uuid, 'confirmation', 'JANE31926', 'W11606707', '2026-03-19'::date, 4384.42::numeric),
('1783cdd3-3a33-4b31-a152-644fe5cdcde8'::uuid, 'confirmation', '816', null, '2026-02-03'::date, null::numeric),
('eafcbbfc-cac0-463d-a891-74a9df4c86b4'::uuid, 'confirmation', 'Wilcor1-19-26', '192156', '2026-01-19'::date, null::numeric),
('fc22b761-6bb8-4375-b8d3-119e0749c8dd'::uuid, 'confirmation', 'SlipperyRacer1-20-26', null, '2026-01-20'::date, 1128::numeric),
('553ba3ad-04a6-42c6-b196-37579c3e0a45'::uuid, 'confirmation', 'PRIARIESCHOONER2326', '30568569', '2026-02-13'::date, 824.48::numeric),
('677de059-fba1-4b87-9347-4385fab18f5f'::uuid, 'confirmation', '2229555', null, '2026-02-03'::date, 278.46::numeric),
('cb8ca226-b1d1-402b-a9d4-a8d235f86c47'::uuid, 'other', 'ARCADE2426', 'SO317043', '2026-02-13'::date, null::numeric),
('bdc793e3-de3b-477a-9e8b-24049b45b8db'::uuid, 'confirmation', 'Jane22426', 'W11488438', '2026-02-24'::date, 1815.71::numeric),
('75a50eef-9e9f-430d-a7df-bab9c5f3dc0c'::uuid, 'invoice', 'PUKA2326revised', '231564', '2026-04-07'::date, 468::numeric)

)
update public.vendor_links l
   set doc_po = coalesce(l.doc_po, r.po),
       doc_number = coalesce(l.doc_number, nullif(trim(split_part(r.num, ',', 1)), '')),
       doc_date = coalesce(l.doc_date, r.dt),
       doc_total = coalesce(l.doc_total, r.tot),
       order_id = coalesce(l.order_id, (select (array_agg(o.id))[1] from public.orders o
                                         where o.vendor_id = l.vendor_id and o.status <> 'cancelled' and r.po is not null
                                           and public.po_norm(o.po_number) = public.po_norm(r.po) having count(*) = 1))
  from r where r.id = l.id;

create or replace function public.wwd_relink(p_org uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
$function$;

select public.wwd_relink(id) from public.organizations;
