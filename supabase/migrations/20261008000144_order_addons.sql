-- 0144 — Add-ons to open orders (Dana, Oct 16; docs/decisions.md "On order and add-ons on the reports"). Add-ons are
-- per order: each open order says whether it can take add-ons until it ships (yes / no / ask the rep; blank until set).
-- Add-on lines are marked with the day they were added. A shipping notice or invoice (the order going shipped,
-- received or entered) turns "yes" to "no" on its own. Adding lines to a confirmed order puts it back to awaiting
-- confirmation: the vendor is asked for one confirmation covering the whole order.
alter table public.orders add column if not exists addons text check (addons in ('yes', 'no', 'ask'));
alter table public.orders add column if not exists addons_asked_at timestamptz;
comment on column public.orders.addons is 'Can this order take add-ons until it ships? yes / no / ask (the rep); null until someone says.';
alter table public.order_lines add column if not exists added_on date;
comment on column public.order_lines.added_on is 'The day this line was added on to an order already sent; null for the original lines.';

create or replace function public.orders_addons_close() returns trigger
language plpgsql as $$
begin
  if new.status in ('shipped', 'received', 'entered', 'ready_to_pay', 'paid', 'cancelled') and old.status is distinct from new.status and new.addons = 'yes' then
    new.addons := 'no';
  end if;
  return new;
end;
$$;
drop trigger if exists orders_addons_close on public.orders;
create trigger orders_addons_close before update of status on public.orders for each row execute function public.orders_addons_close();

-- The add-on: lines onto the order (marked with today), the estimate raised, a confirmed order back to awaiting one.
create or replace function public.order_add_lines(p_order uuid, p_lines jsonb) returns integer
language plpgsql security definer set search_path = public as $$
declare o public.orders%rowtype; n integer := 0; v_sort integer; l jsonb; v_added numeric := 0;
begin
  select * into o from public.orders where id = p_order;
  if not found then raise exception 'Order not found'; end if;
  if auth.uid() is not null and not (public.user_in_org(o.organization_id) and public.user_can_edit()) then raise exception 'Not allowed' using errcode = '42501'; end if;
  if o.status not in ('open', 'awaiting_confirmation', 'confirmed') then raise exception 'This order has shipped; add-ons go on a new order'; end if;
  select coalesce(max(sort_order), 0) into v_sort from public.order_lines where order_id = p_order;
  for l in select * from jsonb_array_elements(coalesce(p_lines, '[]'::jsonb)) loop
    if coalesce((l->>'quantity')::numeric, 0) <= 0 then continue; end if;
    v_sort := v_sort + 1;
    insert into public.order_lines (organization_id, order_id, sort_order, vendor_item_id, description, quantity, unit_cost, added_on)
    values (o.organization_id, p_order, v_sort, nullif(l->>'vendor_item_id', ''), coalesce(l->>'description', ''), (l->>'quantity')::numeric,
            nullif(l->>'unit_cost', '')::numeric, current_date);
    v_added := v_added + round(coalesce((l->>'unit_cost')::numeric, 0) * (l->>'quantity')::numeric, 2);
    n := n + 1;
  end loop;
  if n > 0 then
    update public.orders set est_cost = coalesce(est_cost, 0) + v_added,
           status = case when status = 'confirmed' then 'awaiting_confirmation'::public.order_status else status end
     where id = p_order;
  end if;
  return n;
end;
$$;
revoke execute on function public.order_add_lines(uuid, jsonb) from public, anon;
grant execute on function public.order_add_lines(uuid, jsonb) to authenticated, service_role;
