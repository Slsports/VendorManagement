-- 0377 — The tally counts a sized invoice line against its confirmation item: WFS confirms "F-125-1" (36) and bills
-- "F-125-1-S", "F-125-1-M", "F-125-1-L" (12 each). An invoice item not on the confirmation is tried without its last
-- dash segment before it is called extra. (WFS2426 showed 27 "not on the confirmation" lines that were sizes.)
set local lock_timeout = '5s';

create or replace function public.order_tally(p_order uuid)
returns table (item_key text, vendor_item_id text, description text, ordered numeric, received numeric, still numeric, on_confirmation boolean)
language plpgsql stable security definer set search_path = public as $$
#variable_conflict use_column
declare v_org uuid;
begin
  select organization_id into v_org from public.orders where id = p_order;
  if v_org is null or not (auth.uid() is null or public.user_in_org(v_org)) then return; end if;
  return query
  with conf_check as (
    select c.reading from public.order_checks c
     where c.order_id = p_order and c.kind = 'confirmation' and c.status in ('done', 'to_review') and jsonb_array_length(coalesce(c.reading->'lines', '[]'::jsonb)) > 0
     order by c.created_at desc limit 1
  ), conf_lines as (
    select public.item_key(l->>'vendor_item_id') as k, max(l->>'vendor_item_id') as vid, max(nullif(l->>'description', '')) as d,
           sum(coalesce((l->>'quantity')::numeric, 0)) as q
      from conf_check, jsonb_array_elements(conf_check.reading->'lines') l
     where public.item_key(l->>'vendor_item_id') is not null and coalesce(l->>'backordered', '') not in ('cancelled', 'discontinued')
     group by 1
  ), conf as (
    select * from conf_lines
    union all
    select public.item_key(ol.vendor_item_id), max(ol.vendor_item_id), max(ol.description), sum(ol.quantity)
      from public.order_lines ol where ol.order_id = p_order and ol.wwd_invoice_id is null and public.item_key(ol.vendor_item_id) is not null
       and not exists (select 1 from conf_lines) group by 1
  ), wwd as (
    select public.item_key(coalesce(w.vendor_invoice_number, w.seq)) as inv_key, l.vendor_item_id, l.description, l.quantity
      from public.wwd_invoices w join public.wwd_invoice_lines l on l.invoice_id = w.id
     where w.order_id = p_order and w.kind = 'invoice' and not coalesce(l.is_freight, false)
  ), wwd_keys as (select distinct inv_key from wwd),
  chk as (
    select public.item_key(c.doc_number) as inv_key, l->>'vendor_item_id' as vendor_item_id, l->>'description' as description, (l->>'quantity')::numeric as quantity
      from public.order_checks c, jsonb_array_elements(coalesce(c.reading->'lines', '[]'::jsonb)) l
     where c.order_id = p_order and c.kind = 'invoice' and c.status not in ('not_paperwork', 'dismissed', 'failed')
       and public.item_key(c.doc_number) is not null and public.item_key(c.doc_number) not in (select inv_key from wwd_keys)
  ), raw as (
    select vendor_item_id, description, quantity from wwd union all select vendor_item_id, description, quantity from chk
  ), keyed as (
    -- the item as billed, else without its size (the last dash segment) when that is what the confirmation lists
    select case when exists (select 1 from conf c where c.k = public.item_key(x.vendor_item_id)) then public.item_key(x.vendor_item_id)
                when exists (select 1 from conf c where c.k = public.item_key(regexp_replace(x.vendor_item_id, '-[^-]+$', ''))) then public.item_key(regexp_replace(x.vendor_item_id, '-[^-]+$', ''))
                else public.item_key(x.vendor_item_id) end as k,
           x.vendor_item_id, x.description, x.quantity
      from raw x where public.item_key(x.vendor_item_id) is not null
  ), got as (
    select k, max(vendor_item_id) as vid, max(nullif(description, '')) as d, sum(coalesce(quantity, 0)) as q from keyed group by k
  )
  select coalesce(conf.k, got.k), coalesce(conf.vid, got.vid), coalesce(conf.d, got.d), coalesce(conf.q, 0), coalesce(got.q, 0), greatest(coalesce(conf.q, 0) - coalesce(got.q, 0), 0), conf.k is not null
    from conf full outer join got on got.k = conf.k
   order by (conf.k is null), coalesce(conf.vid, got.vid);
end $$;
revoke execute on function public.order_tally(uuid) from public, anon;
grant execute on function public.order_tally(uuid) to authenticated, service_role;

-- the shipments' running counts follow the better match
do $$ declare r record; begin
  for r in select distinct order_id from public.order_shipments loop perform public.order_shipments_sync(r.order_id); end loop;
end $$;
