-- 0379 — Freight on each shipment (Dana, Nov 13: "add a column for freight percentage"): Worldwide's freight amount on the
-- invoice, else its freight line, else the freight on the vendor's own invoice as Claude read it. The screen shows it against
-- the goods (amount less freight) as a percentage.
set local lock_timeout = '5s';
alter table public.order_shipments add column if not exists freight numeric(12,2);

create or replace function public.order_shipments_sync(p_order uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare o record; v_parts boolean; r record; v_seq integer := 0; v_cum numeric := 0; v_ordered numeric; v_received numeric; v_left numeric; v_last date; v_n integer := 0; v_units numeric;
begin
  select ord.*, v.ships_in_parts into o from public.orders ord join public.vendors v on v.id = ord.vendor_id where ord.id = p_order;
  if o.id is null then return '{}'::jsonb; end if;
  -- the invoices on the order, Worldwide's first, each the vendor's own paper when Worldwide has none
  for r in
    select * from (
      select public.item_key(coalesce(w.vendor_invoice_number, w.seq)) as k, coalesce(w.vendor_invoice_number, w.seq) as num, w.id as wid,
             (select l.id from public.vendor_links l where l.order_id = p_order and l.kind = 'invoice' and public.item_key(l.doc_number) = public.item_key(coalesce(w.vendor_invoice_number, w.seq)) order by l.created_at limit 1) as lid,
             coalesce(w.wwd_date, (select coalesce(l.doc_date, l.received_at::date) from public.vendor_links l where l.order_id = p_order and l.kind = 'invoice' and public.item_key(l.doc_number) = public.item_key(coalesce(w.vendor_invoice_number, w.seq)) order by l.created_at limit 1)) as on_day, w.amount,
             coalesce(w.freight_amount, (select sum(l.amount) from public.wwd_invoice_lines l where l.invoice_id = w.id and coalesce(l.is_freight, false)),
                      (select (c.reading->>'freight')::numeric from public.order_checks c where c.order_id = p_order and c.kind = 'invoice' and c.status not in ('not_paperwork', 'dismissed', 'failed')
                         and public.item_key(coalesce(c.doc_number, (select vl.doc_number from public.vendor_links vl where vl.id = c.document_id))) = public.item_key(coalesce(w.vendor_invoice_number, w.seq)) order by c.created_at desc limit 1)) as freight,
             coalesce(nullif((select coalesce(sum(l.quantity), 0) from public.wwd_invoice_lines l where l.invoice_id = w.id and not coalesce(l.is_freight, false)), 0),
                      -- Worldwide has not loaded the lines yet: Claude's reading of the vendor's own invoice with the same number
                      (select coalesce(sum((x->>'quantity')::numeric), 0) from public.order_checks c, jsonb_array_elements(coalesce(c.reading->'lines', '[]'::jsonb)) x
                        where c.order_id = p_order and c.kind = 'invoice' and c.status not in ('not_paperwork', 'dismissed', 'failed')
                          and public.item_key(coalesce(c.doc_number, (select vl.doc_number from public.vendor_links vl where vl.id = c.document_id))) = public.item_key(coalesce(w.vendor_invoice_number, w.seq)))) as units
        from public.wwd_invoices w where w.order_id = p_order and w.kind = 'invoice'
      union all
      select public.item_key(l.doc_number), l.doc_number, null, l.id, coalesce(l.doc_date, l.received_at), l.doc_total,
             (select (c.reading->>'freight')::numeric from public.order_checks c where c.order_id = p_order and c.kind = 'invoice' and public.item_key(coalesce(c.doc_number, l.doc_number)) = public.item_key(l.doc_number) order by c.created_at desc limit 1),
             (select coalesce(sum((x->>'quantity')::numeric), 0) from public.order_checks c, jsonb_array_elements(coalesce(c.reading->'lines', '[]'::jsonb)) x
               where c.order_id = p_order and c.kind = 'invoice' and public.item_key(c.doc_number) = public.item_key(l.doc_number))
        from public.vendor_links l where l.order_id = p_order and l.kind = 'invoice' and public.item_key(l.doc_number) is not null
         and public.item_key(l.doc_number) not in (select public.item_key(coalesce(w2.vendor_invoice_number, w2.seq)) from public.wwd_invoices w2 where w2.order_id = p_order and w2.kind = 'invoice')
    ) s where s.k is not null order by s.on_day nulls last, s.num
  loop
    v_seq := v_seq + 1; v_cum := v_cum + coalesce(r.units, 0); v_n := v_n + 1;
    insert into public.order_shipments (organization_id, order_id, seq, invoice_key, invoice_number, wwd_invoice_id, vendor_link_id, shipped_on, amount, freight, units, received_so_far)
    values (o.organization_id, p_order, v_seq, r.k, r.num, r.wid, r.lid, r.on_day, r.amount, r.freight, coalesce(r.units, 0), v_cum)
    on conflict (order_id, invoice_key) do update set seq = excluded.seq, invoice_number = excluded.invoice_number, wwd_invoice_id = coalesce(excluded.wwd_invoice_id, order_shipments.wwd_invoice_id),
      vendor_link_id = coalesce(excluded.vendor_link_id, order_shipments.vendor_link_id), shipped_on = coalesce(excluded.shipped_on, order_shipments.shipped_on), amount = coalesce(excluded.amount, order_shipments.amount), freight = coalesce(excluded.freight, order_shipments.freight),
      units = excluded.units, received_so_far = excluded.received_so_far, updated_at = now();
    v_last := greatest(coalesce(v_last, r.on_day), r.on_day);
  end loop;
  if v_n = 0 then return jsonb_build_object('shipments', 0); end if;
  select coalesce(sum(t.ordered), 0), coalesce(sum(least(t.received, t.ordered)), 0), coalesce(sum(t.still), 0) into v_ordered, v_received, v_left from public.order_tally(p_order) t where t.on_confirmation;
  update public.order_shipments set ordered_total = v_ordered where order_id = p_order;
  v_parts := o.ships_in_parts or v_n > 1;
  if o.status in ('open', 'awaiting_confirmation', 'confirmed', 'shipped') then
    if v_parts and (v_ordered = 0 or v_left > 0) then
      -- shipped in part: on order until the confirmation is filled (or there is no item list to fill)
      if o.status <> 'shipped' then
        update public.orders set status = 'shipped',
               notes = concat_ws(E'\n', nullif(notes, ''), case when v_ordered = 0 then format('Shipped in part: %s shipment(s) so far, the first %s. VMS has no item list from a confirmation to check them against, so it stays on order until someone marks it received.', v_n, to_char((select min(shipped_on) from public.order_shipments where order_id = p_order), 'Mon FMDD, YYYY'))
                                                                else format('Shipped in part: %s shipment(s) so far, %s of %s items in, %s still to come (against the confirmation).', v_n, v_received, v_ordered, v_left) end)
         where id = p_order;
        perform public.order_history_date(p_order, 'shipped', ((select min(shipped_on) from public.order_shipments where order_id = p_order)::timestamp + time '12:00') at time zone 'America/Los_Angeles');
      end if;
    else
      update public.orders set status = 'received', date_received = coalesce(date_received, v_last),
             notes = concat_ws(E'\n', nullif(notes, ''), format('Received as of %s: %s shipment(s), %s of %s items in against the confirmation. VMS closed it out on %s.', to_char(v_last, 'Mon FMDD, YYYY'), v_n, v_received, v_ordered, to_char(now() at time zone 'America/Los_Angeles', 'Mon FMDD, YYYY')))
       where id = p_order;
      perform public.order_history_date(p_order, 'received', (v_last::timestamp + time '12:00') at time zone 'America/Los_Angeles');
    end if;
  end if;
  return jsonb_build_object('shipments', v_n, 'ordered', v_ordered, 'received', v_received, 'still', v_left);
end $$;
revoke execute on function public.order_shipments_sync(uuid) from public, anon, authenticated;
grant execute on function public.order_shipments_sync(uuid) to service_role;

do $$ declare r record; begin
  for r in select distinct order_id from public.order_shipments loop perform public.order_shipments_sync(r.order_id); end loop;
end $$;
