-- 0383 — Dana, Nov 13 ("Yes, if you can confirm the same pattern for 2024, do it"): confirmed by Worldwide's invoice numbers
-- (68259 and -02…-05 for Pulse W24 clothing; 73370 and -02…-04 for Shaver Lake C; 58982-03…-12 for fall 2023; 67635 and
-- 67635-02; 73375 and 73375-02B), those per-shipment rows fold into their one order. A folded order that is paid takes
-- Worldwide's invoice total as its final cost (the rows' costs were one shipment each).
set local lock_timeout = '5s';

create or replace function public.order_fold_final_cost(p_order uuid) returns numeric
language plpgsql security definer set search_path = public as $$
declare v numeric;
begin
  select sum(coalesce(w.paid_amount, w.amount)) into v from public.wwd_invoices w where w.order_id = p_order and w.kind = 'invoice';
  if v is null then return null; end if;
  if exists (select 1 from public.wwd_invoices w where w.order_id = p_order and w.kind = 'invoice' and w.paid_date is null and w.sheet_paid_date is null) then return null; end if;
  update public.orders set final_cost = v,
         notes = case when final_cost is distinct from v then concat_ws(E'\n', nullif(notes, ''), format('Final cost %s: Worldwide''s %s invoices on this order, all paid.', '$' || to_char(v, 'FM999,999,990.00'), (select count(*) from public.wwd_invoices w where w.order_id = p_order and w.kind = 'invoice'))) else notes end
   where id = p_order and status = 'paid';
  return v;
end $$;
revoke execute on function public.order_fold_final_cost(uuid) from public, anon, authenticated;
grant execute on function public.order_fold_final_cost(uuid) to service_role;

do $$
declare v uuid; k uuid; parts uuid[]; n integer; r record;
begin
  select id into v from public.vendors where name = 'WORLD FAMOUS SPORTS' and ships_in_parts order by created_at limit 1;
  if v is null then return; end if;

  -- Pulse W24 clothing (Sept-Oct 2024): the 9/11/24 row (invoice 68259) keeps
  select id into k from public.orders where vendor_id = v and po_number like 'PULSE W24CLOTHI%' and order_date = '2024-09-11';
  select array_agg(id) into parts from public.orders where vendor_id = v and status <> 'cancelled' and id <> k and replace(upper(po_number), ' ', '') like 'PULSEW24CLOTHI%';
  if k is not null and parts is not null then
    n := public.order_fold_parts(k, parts, true, 'A shipment of the Pulse W24 clothing order, invoices 68259-02 to -05 (Dana, 11/13/2026: fold them).');
    update public.orders set po_number = 'PULSE W24CLOTHING' where id = k;
    raise notice 'PULSE: % folded', n;
  end if;

  -- Shaver Lake C (camping, Aug 2024 show): the 8/27/24 row (invoices 73370, 73370-03) keeps
  select id into k from public.orders where vendor_id = v and replace(upper(po_number), ' ', '') = 'SHAVERLAKEC' and order_date = '2024-08-27';
  select array_agg(id) into parts from public.orders where vendor_id = v and status <> 'cancelled' and id <> k and replace(upper(po_number), ' ', '') = 'SHAVERLAKEC';
  if k is not null and parts is not null then
    n := public.order_fold_parts(k, parts, true, 'A shipment of the Shaver Lake C camping order, invoices 73370-02 and -04 (Dana, 11/13/2026: fold them).');
    update public.orders set po_number = 'SHAVER LAKE C' where id = k;
    raise notice 'SHAVER LAKE C: % folded', n;
  end if;

  -- fall 2023 (SO 58982, invoices -02 to -12): the 8/17/23 row keeps
  select id into k from public.orders where vendor_id = v and po_number = '58982' and order_date = '2023-08-17';
  select array_agg(id) into parts from public.orders where vendor_id = v and status <> 'cancelled' and id <> k and (po_number like '58982%' or po_number like 'F23/58982%');
  if k is not null and parts is not null then
    n := public.order_fold_parts(k, parts, true, 'A shipment of the fall 2023 order SO 58982 (Dana, 11/13/2026: fold them).');
    raise notice '58982: % folded', n;
  end if;

  -- the pairs: 67635 / 67635-02 and 73375 / 73375-02B
  select id into k from public.orders where vendor_id = v and po_number = 'S67635/67635-02';
  select array_agg(id) into parts from public.orders where vendor_id = v and status <> 'cancelled' and po_number = '67635INV';
  if k is not null and parts is not null then n := public.order_fold_parts(k, parts, true, 'A shipment of order 67635 (Dana, 11/13/2026: fold them).'); raise notice '67635: % folded', n; end if;
  select id into k from public.orders where vendor_id = v and po_number = 'S73375/73375-02B';
  select array_agg(id) into parts from public.orders where vendor_id = v and status <> 'cancelled' and po_number = 'INV73375';
  if k is not null and parts is not null then n := public.order_fold_parts(k, parts, true, 'A shipment of order 73375 (Dana, 11/13/2026: fold them).'); raise notice '73375: % folded', n; end if;

  -- every folded, paid order: final cost = Worldwide's invoices
  for r in select distinct m.kept_order_id from public.order_merges m join public.orders o on o.id = m.kept_order_id where o.vendor_id = v and m.note like '%fold them%' loop
    perform public.order_fold_final_cost(r.kept_order_id);
  end loop;
end $$;
