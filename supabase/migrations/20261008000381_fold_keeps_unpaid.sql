-- 0381 — A fold never calls the order paid while one of its invoices is not: the merge takes the furthest-along status of
-- the parts, which made I87727 Paid when WORLD020526 (paid 10/8) folded in, though its fourth invoice I87727-3 ($838.20,
-- 10/1) is not paid. The fold now puts the kept status back in that case (the hourly close-out marks it Paid when the last
-- invoice is), and I87727 goes back to Entered with today's wrong Paid row removed.
set local lock_timeout = '5s';

create or replace function public.order_fold_parts(p_keep uuid, p_parts uuid[], p_sum boolean, p_note text) returns integer
language plpgsql security definer set search_path = public as $$
declare p uuid; n integer := 0; v_est numeric; v_final numeric; v_recv date; v_pos text; v_status public.order_status;
begin
  select coalesce(est_cost, 0), final_cost, date_received, status into v_est, v_final, v_recv, v_status from public.orders where id = p_keep;
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
  -- a part's Paid does not pay the whole order while an invoice on it is still open
  if v_status <> 'paid' and (select status from public.orders where id = p_keep) = 'paid'
     and exists (select 1 from public.wwd_invoices w where w.order_id = p_keep and w.kind = 'invoice' and w.paid_date is null and w.sheet_paid_date is null) then
    update public.orders set status = v_status, paid_date = null where id = p_keep;
    delete from public.order_status_history where order_id = p_keep and to_status = 'paid' and changed_at > now() - interval '1 minute';
  end if;
  perform public.order_shipments_sync(p_keep);
  return n;
end $$;

do $$ declare k uuid; begin
  select o.id into k from public.orders o join public.vendors v on v.id = o.vendor_id where v.name = 'WORLD FAMOUS SPORTS' and o.po_number = 'I87727' and o.status = 'paid'
   and exists (select 1 from public.wwd_invoices w where w.order_id = o.id and w.kind = 'invoice' and w.paid_date is null and w.sheet_paid_date is null);
  if k is not null then
    update public.orders set status = 'entered', paid_date = null,
           notes = concat_ws(E'\n', nullif(notes, ''), 'Back to Entered 11/13/2026: the fold had taken WORLD020526''s Paid, but invoice I87727-3 ($838.20, 10/1/26) is not paid yet.')
     where id = k;
    delete from public.order_status_history where order_id = k and to_status = 'paid' and changed_at::date = current_date;
  end if;
end $$;
