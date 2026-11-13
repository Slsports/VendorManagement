-- 0380 — Dana, Nov 13 ("Ok fold"): WFS's per-shipment sheet rows fold into their one order per show. order_fold_parts(keep,
-- parts, sum_costs) merges each part into the kept order (everything moves: invoices, papers, checks, tasks, history rows with
-- their own dates), and when the kept row was itself only the first shipment its cost becomes the sum and its received date
-- the last shipment's. Then the shipments are rebuilt from the invoices.
set local lock_timeout = '5s';

create or replace function public.order_fold_parts(p_keep uuid, p_parts uuid[], p_sum boolean, p_note text) returns integer
language plpgsql security definer set search_path = public as $$
declare p uuid; n integer := 0; v_est numeric; v_final numeric; v_recv date; v_pos text;
begin
  select coalesce(est_cost, 0), final_cost, date_received into v_est, v_final, v_recv from public.orders where id = p_keep;
  select string_agg(coalesce(po_number, '?') || coalesce(' ' || to_char(order_date, 'FMMM/FMDD/YY'), ''), ', ' order by order_date, po_number) into v_pos from public.orders where id = any (p_parts);
  foreach p in array p_parts loop
    select v_est + coalesce(o.est_cost, 0), case when v_final is null and o.final_cost is null then null else coalesce(v_final, 0) + coalesce(o.final_cost, 0) end,
           greatest(v_recv, o.date_received) into v_est, v_final, v_recv from public.orders o where o.id = p;
    perform public.order_duplicate_merge(p_keep, p, p_note);
    n := n + 1;
  end loop;
  if p_sum and n > 0 then
    update public.orders set est_cost = v_est, final_cost = v_final, date_received = coalesce(v_recv, date_received),
           notes = concat_ws(E'\n', nullif(notes, ''), format('Folded %s: %s shipment rows of this order (%s) are in here now; the cost is their sum and the received date the last shipment''s.', to_char(current_date, 'FMMM/FMDD/YYYY'), n, v_pos))
     where id = p_keep;
  elsif n > 0 then
    update public.orders set notes = concat_ws(E'\n', nullif(notes, ''), format('Folded %s: %s shipment rows of this order (%s) are in here now.', to_char(current_date, 'FMMM/FMDD/YYYY'), n, v_pos)) where id = p_keep;
  end if;
  perform public.order_shipments_sync(p_keep);
  return n;
end $$;
revoke execute on function public.order_fold_parts(uuid, uuid[], boolean, text) from public, anon, authenticated;
grant execute on function public.order_fold_parts(uuid, uuid[], boolean, text) to service_role;

do $$
declare v uuid; k uuid; parts uuid[]; n integer; g record;
begin
  select id into v from public.vendors where name = 'WORLD FAMOUS SPORTS' and ships_in_parts order by created_at limit 1;
  if v is null then return; end if;
  -- the I88198 shipments into WFS2426 (its cost on the sheet is the whole order)
  select id into k from public.orders where vendor_id = v and po_number = 'WFS2426';
  select array_agg(id) into parts from public.orders where vendor_id = v and po_number in ('I88198-2', 'I88198-3', 'I88198-4');
  if k is not null and parts is not null then n := public.order_fold_parts(k, parts, false, 'A shipment of WFS2426 (Dana, 11/13/2026: fold them).'); raise notice 'WFS2426: % folded', n; end if;
  -- the hunting hoodies into I87727
  select id into k from public.orders where vendor_id = v and po_number = 'I87727';
  select array_agg(id) into parts from public.orders where vendor_id = v and po_number = 'WORLD020526';
  if k is not null and parts is not null then n := public.order_fold_parts(k, parts, true, 'A shipment of I87727 (Dana, 11/13/2026: fold them).'); raise notice 'I87727: % folded', n; end if;
  -- one order per WFS number: the earliest (largest) row keeps, the rest are its shipments
  for g in select * from (values ('B671437'), ('B671464'), ('B671629')) t(num) loop
    select id into k from public.orders where vendor_id = v and status <> 'cancelled' and (po_number = g.num or po_number like g.num || ' /%') order by order_date nulls last, est_cost desc nulls last limit 1;
    select array_agg(id) into parts from public.orders where vendor_id = v and status <> 'cancelled' and id <> k and (po_number = g.num or po_number like g.num || ' /%');
    if k is not null and parts is not null then n := public.order_fold_parts(k, parts, true, format('A shipment of %s (Dana, 11/13/2026: fold them).', g.num)); raise notice '%: % folded', g.num, n; end if;
  end loop;
end $$;
