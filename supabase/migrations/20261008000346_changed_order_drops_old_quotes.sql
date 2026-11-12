-- 0346 — A changed order's old freight quotes are deleted (Dana, Nov 11, Paricon: "The 2274 needs to be deleted. That would
-- probably not be what we were charged last year so it is totally erroneous info. I never want vms to do something like
-- that"). Ted's $2,274 (7 pallets, 2,559 lbs) was for last year's order sheet, which Dana had sent by mistake; her corrected
-- order changed the items, so the quote and its details were wrong for this order.
--   • When a newer email changes an order's items (our revised order, or an ordering service's "changed"), every freight
--     quote on that order from before that email that no one has approved is deleted, and its task closes as made by
--     mistake. The vendor's next quote starts fresh.
--   • Now: the Paricon quote is deleted, Trevor's task for it closes, and the order note no longer carries its numbers.
set local lock_timeout = '5s';

create or replace function public.order_revised_drop_quotes(p_order uuid, p_email uuid) returns integer
language plpgsql security definer set search_path = public as $$
declare q record; v_at timestamptz; k integer := 0;
begin
  select received_at into v_at from public.emails where id = p_email;
  if v_at is null then return 0; end if;
  for q in select x.id, x.task_id, x.organization_id from public.freight_quotes x
            where x.order_id = p_order and x.status in ('waiting', 'needs_order')
              and coalesce((select e.received_at from public.emails e where e.id = x.email_id), x.created_at) < v_at loop
    update public.tasks set done_at = now(), closed_how = 'mistake',
           done_note = format('Made by mistake: the freight quote was for the order before our email of %s changed it. Ask the vendor for a new quote.', to_char(v_at at time zone 'America/Los_Angeles', 'Mon FMDD, YYYY'))
     where organization_id = q.organization_id and done_at is null
       and (id = q.task_id or auto_key = 'freight_quote:' || q.id);
    delete from public.freight_quotes where id = q.id;
    k := k + 1;
  end loop;
  return k;
end;
$$;
revoke execute on function public.order_revised_drop_quotes(uuid, uuid) from public, anon, authenticated;
grant execute on function public.order_revised_drop_quotes(uuid, uuid) to service_role;

-- Paricon Paricon-11-10-26: Ted's quote for last year's sheet
do $$ begin
  if exists (select 1 from public.orders where id = '3d380dce-90f7-4981-b40d-b8d6142f2f31') then
    perform public.order_revised_drop_quotes('3d380dce-90f7-4981-b40d-b8d6142f2f31', 'fac1f717-40aa-4b38-af22-eb3d1ee32e49');
    update public.orders set notes = 'Ordered by email Nov 10, 2026 (Dana to Ted Morton). That first email had last year''s order sheet by mistake; Dana sent the correct sheet on Nov 11 (11 items, PO Paricon-11-10-26) and asked Ted to hold it. Ship direct, not to Worldwide Kent (Dana, Nov 11; the sheet still shows FOB Kent). The Shredder-130 snowboard (SB-130, 4) has no price on the sheet, and its total box shows 4, so the sheet''s $5,989.58 is $4 high: the priced items come to $5,985.58. Freight: a quote for this order is still needed. Paricon offers prepaid freight only on orders of $25,000 or more.'
     where id = '3d380dce-90f7-4981-b40d-b8d6142f2f31';
  end if;
end $$;
