-- 0220 — No discount on freight (Nichole at WWD, Oct 21): Edenred's N/D Freight (Y/N) says whether the terms discount
-- is allowed on an invoice's freight; NDOF Amount is the freight amount with no discount. VMS keeps the amount beside
-- the flag (wwd_invoices.ndof_amount); wwd_edenred_lines reads it from the line export. The Oct 21 export's amounts are
-- filled in by a one-time load from that file (no new upload).

alter table public.wwd_invoices add column if not exists ndof_amount numeric(12, 2);
comment on column public.wwd_invoices.nd_freight is 'Edenred''s N/D Freight: true = no terms discount on this invoice''s freight.';
comment on column public.wwd_invoices.ndof_amount is 'Edenred''s NDOF Amount: the freight amount with no terms discount.';

create or replace function public.wwd_edenred_lines(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_org    uuid := coalesce(public.current_user_org(), nullif(p->>'organization_id', '')::uuid);
  v_asof   date := coalesce(nullif(p->>'as_of', '')::date, current_date);
  r        jsonb;
  l        jsonb;
  w        public.wwd_invoices%rowtype;
  o        public.orders%rowtype;
  v_n      integer;
  v_free   numeric;
  v_res    text;
  v_cand   uuid;
  v_cnt    integer;
  v_orders uuid[] := '{}';
  v_oid    uuid;
  v_sum    numeric;
  n_inv integer := 0; n_lines integer := 0; n_missing integer := 0; n_tied integer := 0; n_po_cards integer := 0;
  n_credit integer := 0; n_credit_cards integer := 0; n_items integer := 0; n_freight_set integer := 0; n_freight_cards integer := 0;
  n_vendor integer := 0;
begin
  if auth.uid() is not null and not public.user_can_edit() then raise exception 'Only admins, managers and buyers import WWD files' using errcode = '42501'; end if;
  if v_org is null then raise exception 'Which organization?' using errcode = '22023'; end if;

  for r in select * from jsonb_array_elements(coalesce(p->'invoices', '[]')) loop
    select * into w from public.wwd_invoices
     where organization_id = v_org and ltrim(seq, '0') = ltrim(regexp_replace(coalesce(r->>'seq', ''), '[^0-9]', '', 'g'), '0')
     order by (kind = 'credit') = coalesce((r->>'credit')::boolean, false) desc, created_at limit 1;
    if w.id is null then n_missing := n_missing + 1; continue; end if;
    n_inv := n_inv + 1;

    -- the lines, replaced
    delete from public.wwd_invoice_lines where invoice_id = w.id;
    v_n := 0;
    for l in select * from jsonb_array_elements(coalesce(r->'lines', '[]')) loop
      v_n := v_n + 1;
      insert into public.wwd_invoice_lines (organization_id, invoice_id, line_no, vendor_item_id, upc, description, quantity, unit_price, unit_discount, amount, is_freight)
      values (v_org, w.id, v_n, nullif(trim(l->>'vid'), ''), nullif(trim(l->>'upc'), ''), nullif(trim(l->>'desc'), ''),
              nullif(l->>'qty', '')::numeric, nullif(l->>'price', '')::numeric, nullif(l->>'unit_discount', '')::numeric, nullif(l->>'amount', '')::numeric,
              coalesce(l->>'desc', '') ~* '(freight|shipping)' and nullif(trim(l->>'vid'), '') is null and nullif(trim(l->>'upc'), '') is null);
    end loop;
    n_lines := n_lines + v_n;
    v_free := coalesce(nullif(nullif(r->>'freight', ''), '0')::numeric,
                       (select sum(amount) from public.wwd_invoice_lines where invoice_id = w.id and is_freight), 0);
    update public.wwd_invoices set
      nd_freight = case upper(coalesce(r->>'nd_freight', '')) when 'Y' then true when 'N' then false else nd_freight end,
      ndof_amount = coalesce(nullif(r->>'ndof', '')::numeric, ndof_amount),
      tracking_no = coalesce(tracking_no, nullif(trim(r->>'tracking'), '')),
      misc_amount = coalesce(misc_amount, nullif(nullif(r->>'misc', ''), '0')::numeric),
      edenred_freight = v_free, lines_loaded_at = now()
     where id = w.id;

    -- the vendor: still with WWD?
    if w.vendor_id is not null and upper(coalesce(r->>'vendor_active', '')) in ('A', 'I') then
      update public.vendors set wwd_active = upper(r->>'vendor_active') = 'A', wwd_active_as_of = v_asof
       where id = w.vendor_id and (wwd_active_as_of is null or wwd_active_as_of <= v_asof)
         and (wwd_active is distinct from (upper(r->>'vendor_active') = 'A') or wwd_active_as_of is distinct from v_asof);
      if found then n_vendor := n_vendor + 1; end if;
    end if;

    -- an untied invoice: the vendor's one order with this PO
    if w.order_id is null and w.vendor_id is not null and public.is_real_po(w.po_number) then
      select min(id::text)::uuid, count(*) into v_cand, v_cnt from public.orders
       where vendor_id = w.vendor_id and status <> 'cancelled' and public.po_loose(po_number) = public.po_loose(w.po_number);
      if v_cnt = 1 then
        update public.wwd_invoices set order_id = v_cand, order_set_by = 'auto' where id = w.id;
        w.order_id := v_cand;
        n_tied := n_tied + 1;
      end if;
    end if;

    -- the PO
    select * into o from public.orders where id = w.order_id;
    v_res := public.wwd_po_result(w.po_number, o.po_number, (select po_code from public.vendors where id = w.vendor_id), (select name from public.vendors where id = w.vendor_id));
    update public.wwd_invoices set po_result = v_res where id = w.id;
    if o.id is not null and w.kind <> 'credit' and public.po_loose(w.po_number) is not null and public.po_loose(o.po_number) is not null and not public.wwd_po_matches(w.po_number, o.po_number)
       and not exists (select 1 from public.review_items where kind = 'wwd_po_mismatch' and entity_id = w.id) then
      insert into public.review_items (organization_id, kind, entity_type, entity_id, title, details)
      values (v_org, 'wwd_po_mismatch', 'wwd_invoice', w.id,
              left(coalesce((select name from public.vendors where id = w.vendor_id), w.wwd_vendor_name, 'WWD invoice') || ': PO ' || w.po_number || ' on WWD Seq # ' || w.seq || ', order PO ' || o.po_number, 200),
              jsonb_build_object('invoice_po', w.po_number, 'order_po', o.po_number, 'order_id', o.id, 'seq', w.seq, 'vendor_id', w.vendor_id));
      n_po_cards := n_po_cards + 1;
    end if;

    if w.order_id is not null and w.kind = 'invoice' then v_orders := array_append(v_orders, w.order_id); end if;
  end loop;

  -- credits: the invoice they are for (same vendor and PO, before the credit), else a card
  for w in select * from public.wwd_invoices i where i.organization_id = v_org and i.kind = 'credit' and i.credit_for_id is null and i.lines_loaded_at is not null loop
    select min(id::text)::uuid, count(*) into v_cand, v_cnt from public.wwd_invoices x
     where x.organization_id = v_org and x.kind = 'invoice' and x.vendor_id = w.vendor_id and w.vendor_id is not null
       and public.po_loose(w.po_number) is not null and public.po_loose(x.po_number) = public.po_loose(w.po_number)
       and coalesce(x.wwd_date, x.vendor_invoice_date) <= coalesce(w.wwd_date, w.vendor_invoice_date, current_date);
    if v_cnt = 1 then
      update public.wwd_invoices set credit_for_id = v_cand where id = w.id;
      n_credit := n_credit + 1;
    elsif not exists (select 1 from public.review_items where kind = 'wwd_credit_for' and entity_id = w.id) then
      insert into public.review_items (organization_id, kind, entity_type, entity_id, title, details)
      values (v_org, 'wwd_credit_for', 'wwd_invoice', w.id,
              left('WWD credit ' || to_char(abs(w.amount), 'FM$999,999,990.00') || ' from ' || coalesce((select name from public.vendors where id = w.vendor_id), w.wwd_vendor_name, 'a vendor')
                   || ' (WWD Seq # ' || w.seq || '): which invoice is it for?', 200),
              jsonb_build_object('seq', w.seq, 'vendor_id', w.vendor_id, 'amount', w.amount, 'po_number', w.po_number,
                                 'vendor_invoice_number', w.vendor_invoice_number, 'lines', (select jsonb_agg(description order by line_no) from public.wwd_invoice_lines where invoice_id = w.id)));
      n_credit_cards := n_credit_cards + 1;
    end if;
  end loop;

  -- orders: items from their invoices when they have none; freight from Edenred, or a card when it differs
  foreach v_oid in array coalesce((select array_agg(distinct x) from unnest(v_orders) x), '{}'::uuid[]) loop
    select * into o from public.orders where id = v_oid;
    if not exists (select 1 from public.order_lines where order_id = v_oid) then
      insert into public.order_lines (organization_id, order_id, sort_order, vendor_item_id, upc, description, quantity, unit_cost, wwd_invoice_id, notes)
      select o.organization_id, v_oid, row_number() over (order by i.wwd_date, i.seq, l.line_no), coalesce(l.vendor_item_id, l.upc), l.upc, l.description, l.quantity,
             round(coalesce(l.unit_price, 0) - coalesce(l.unit_discount, 0), 4), i.id, 'From WWD invoice ' || i.seq
        from public.wwd_invoices i join public.wwd_invoice_lines l on l.invoice_id = i.id
       where i.order_id = v_oid and i.kind = 'invoice' and not l.is_freight and l.quantity is not null and l.quantity <> 0
         -- one vendor invoice WWD posted twice counts once
         and not exists (select 1 from public.wwd_invoices i2 where i2.order_id = v_oid and i2.kind = 'invoice' and i2.id <> i.id
                          and public.vin_norm(i2.vendor_invoice_number) = public.vin_norm(i.vendor_invoice_number)
                          and (i2.seq < i.seq or (i2.seq = i.seq and i2.id < i.id)));
      get diagnostics v_cnt = row_count;
      if v_cnt > 0 then n_items := n_items + 1; end if;
    end if;
    -- freight from a shared (pallet) bill is Trevor's, not compared
    if exists (select 1 from public.freight_bill_lines fl where fl.order_id = v_oid and fl.confirmed) then continue; end if;
    select coalesce(sum(edenred_freight), 0) into v_sum from public.wwd_invoices i where i.order_id = v_oid and i.kind = 'invoice' and i.lines_loaded_at is not null
       and not exists (select 1 from public.wwd_invoices i2 where i2.order_id = v_oid and i2.kind = 'invoice' and i2.id <> i.id
                        and public.vin_norm(i2.vendor_invoice_number) = public.vin_norm(i.vendor_invoice_number) and (i2.seq < i.seq or (i2.seq = i.seq and i2.id < i.id)));
    if o.freight_cost is null and v_sum > 0 then
      update public.orders set freight_cost = v_sum, freight_notes = coalesce(freight_notes, 'From the WWD invoice (Edenred)') where id = v_oid;
      n_freight_set := n_freight_set + 1;
    elsif (o.freight_cost is not null and abs(o.freight_cost - v_sum) > 0.01) or (o.free_shipping is true and v_sum > 0) then
      if not exists (select 1 from public.review_items where kind = 'wwd_freight_differs' and entity_id = v_oid and status = 'pending') then
        insert into public.review_items (organization_id, kind, entity_type, entity_id, title, details)
        values (o.organization_id, 'wwd_freight_differs', 'order', v_oid,
                left(coalesce((select name from public.vendors where id = o.vendor_id), 'Order') || coalesce(' PO ' || o.po_number, '') || ': freight '
                     || case when o.free_shipping is true and v_sum > 0 and o.freight_cost is null then 'charged on an order that ships free'
                             else coalesce(to_char(o.freight_cost, 'FM$999,999,990.00'), 'none') || ' in VMS, ' || to_char(v_sum, 'FM$999,999,990.00') || ' in Edenred' end, 200),
                jsonb_build_object('order_id', v_oid, 'vms', o.freight_cost, 'edenred', v_sum, 'free_shipping', o.free_shipping));
        n_freight_cards := n_freight_cards + 1;
      end if;
    end if;
  end loop;

  return jsonb_build_object('invoices', n_inv, 'lines', n_lines, 'not_in_vms', n_missing, 'tied_by_po', n_tied, 'po_cards', n_po_cards,
    'credits_linked', n_credit, 'credit_cards', n_credit_cards, 'orders_given_items', n_items, 'freight_filled', n_freight_set,
    'freight_cards', n_freight_cards, 'vendors_wwd_status', n_vendor,
    'shared_bills', public.freight_shared_from_wwd(v_org));
end;
$$;
