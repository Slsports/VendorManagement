-- 0361 — One shipping email (Dana, Nov 12: "yes remove old"). A confirmed order gave Trevor two emails in his Drafts: the
-- shipment details email (0268/0323, the 10% rule, the form, the routing letter) and the October placeholder "Shipping
-- instructions for PO …" from order_ship_start. The placeholder is gone; the "Ship and receive" task stays (freight, LS PO,
-- receiving) and points to the shipment details email. None of the placeholder drafts was waiting.
set local lock_timeout = '5s';

create or replace function public.order_ship_start(p_order uuid) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  o       public.orders%rowtype;
  v       public.vendors%rowtype;
  v_who   uuid;
  v_task  uuid;
  v_po    text;
  v_due   date;
begin
  select * into o from public.orders where id = p_order;
  if o.id is null or o.status <> 'confirmed' or o.vendor_id is null then return null; end if;
  select * into v from public.vendors where id = o.vendor_id;
  if v.web_orders then return null; end if;
  if exists (select 1 from public.tasks where organization_id = o.organization_id and auto_key = 'ship:' || o.id) then return null; end if;
  v_who := coalesce(public.logistics_person(o.organization_id), public.org_admin(o.organization_id));
  v_po := coalesce('PO ' || nullif(trim(o.po_number), ''), 'your order');

  -- Trevor's hand-off
  v_due := public.next_business_day(now());
  insert into public.tasks (organization_id, title, notes, due_date, remind_at, assigned_to, vendor_id, order_id, auto_key)
  values (o.organization_id,
          left('Ship and receive: ' || coalesce(v.name, 'vendor') || ', ' || v_po, 200),
          'The confirmation is approved. 1) Send the shipment details email (its own task, ready in Mail › Drafts, with our routing letter). '
            || '2) Route the freight when a quote is needed. 3) Finish the LS PO. 4) When it arrives, check it in and click Mark received.',
          v_due, (v_due + time '09:00') at time zone 'America/Los_Angeles', v_who, v.id, o.id, 'ship:' || o.id)
  on conflict (organization_id, auto_key) where auto_key is not null do nothing
  returning id into v_task;
  return v_task;
end;
$$;

create or replace function public.order_ship_action(p_order uuid, p_action text) returns uuid
language plpgsql security definer set search_path = public as $$
declare o public.orders%rowtype;
begin
  select * into o from public.orders where id = p_order;
  if o.id is null or not public.user_in_org(o.organization_id) or not public.user_can_edit() then raise exception 'Order not found' using errcode = '23503'; end if;
  if p_action = 'start' then
    if o.status <> 'confirmed' then raise exception 'The order is not confirmed yet' using errcode = '22023'; end if;
    -- the hand-off by hand also makes the shipment details email when there is none (Nov 12)
    perform public.shipment_request_make(o.id, false);
    return public.order_ship_start(o.id);
  elsif p_action = 'received' then
    if o.status not in ('open', 'awaiting_confirmation', 'confirmed', 'shipped') then raise exception 'This order is already past receiving' using errcode = '22023'; end if;
    update public.orders set status = 'received', date_received = coalesce(date_received, current_date) where id = o.id;
    return null;
  end if;
  raise exception 'Unknown action %', p_action using errcode = '22023';
end;
$$;
