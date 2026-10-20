-- 0213 — After the confirmation is approved: the shipping email and Trevor's hand-off (Dana, Oct 20): "Once we approve the
-- confirmation we need a shipping email to be prepared with our freight routing instructions. At that point the order is
-- passed to Trevor for proper routing, creating the po in LS and receipt of the product. We will work on the content of
-- that email & routing instructions letter later."
--   • When a person confirms an order (confirmation check done or sent, "This is our order"), VMS puts the shipping email
--     in Mail › Drafts for the logistics person (Trevor), to the vendor's orders / shipping / rep contacts, with the
--     current routing letter attached when one is uploaded (a letter uploaded later is attached to drafts still waiting).
--   • A task "Ship and receive" goes to Trevor: send the shipping email, route the freight, the LS PO, receive it. It opens
--     the order's Shipping & receiving box and closes when the order is received (or later, or cancelled).
--   • Web-order vendors (Kelli's) are left out, as they are for the routing letter. Imports never start it.
-- The email text is a placeholder until Dana writes it.

alter table public.email_drafts add column if not exists order_id uuid references public.orders(id) on delete set null;
alter table public.email_drafts add column if not exists attach_routing_letter boolean not null default false;
comment on column public.email_drafts.order_id is 'The order this shipping email is for (Dana, Oct 20); stamped on the order when it sends.';
comment on column public.email_drafts.attach_routing_letter is 'Attach the current routing letter when it sends.';
create index if not exists email_drafts_order_idx on public.email_drafts (order_id) where order_id is not null;

alter table public.orders add column if not exists ship_email_id uuid references public.emails(id) on delete set null;
alter table public.orders add column if not exists ship_email_sent_at timestamptz;
comment on column public.orders.ship_email_sent_at is 'When the shipping email with our routing instructions went to the vendor (Dana, Oct 20).';

-- The shipping email and Trevor's task for one confirmed order. Internal: callers check rights. Returns the task.
create or replace function public.order_ship_start(p_order uuid) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  o       public.orders%rowtype;
  v       public.vendors%rowtype;
  v_who   uuid;
  v_task  uuid;
  v_to    text[];
  v_first text;
  v_po    text;
  v_letter boolean;
  v_due   date;
begin
  select * into o from public.orders where id = p_order;
  if o.id is null or o.status <> 'confirmed' or o.vendor_id is null then return null; end if;
  select * into v from public.vendors where id = o.vendor_id;
  if v.web_orders then return null; end if;
  if exists (select 1 from public.tasks where organization_id = o.organization_id and auto_key = 'ship:' || o.id) then return null; end if;
  v_who := coalesce(public.logistics_person(o.organization_id), public.org_admin(o.organization_id));
  v_po := coalesce('PO ' || nullif(trim(o.po_number), ''), 'your order');
  v_letter := exists (select 1 from public.routing_letters where organization_id = o.organization_id);

  -- the shipping email (placeholder text until Dana writes it)
  if v_who is not null and o.ship_email_sent_at is null and not exists (select 1 from public.email_drafts where order_id = o.id) then
    select coalesce(array_agg(email order by contact_name nulls last), '{}'), min(split_part(nullif(trim(contact_name), ''), ' ', 1))
      into v_to, v_first from public.routing_recipients(v.id);
    insert into public.email_drafts (organization_id, owner_id, created_by, to_emails, subject, body, vendor_id, note, order_id, attach_routing_letter)
    values (o.organization_id, v_who, null, v_to,
            'Shipping instructions for ' || v_po || ' – Shaver Lake Sports',
            'Hi ' || case when cardinality(v_to) = 1 and v_first is not null then v_first else 'there' end || E',\n\n'
              || 'Thank you for confirming ' || v_po || E'. Please ship it following our freight routing instructions'
              || case when v_letter then ' (attached)' else '' end || E'.\n\n'
              || E'Before it ships, please send us the ship date, the freight quote if it ships by pallet, and the tracking or PRO number.\n\n'
              || 'Thank you,',
            v.id,
            'Shipping email for ' || coalesce(v.name, 'vendor') || ', ' || v_po
              || case when v_letter then ' (the routing letter is attached when it sends)' else ' (no routing letter uploaded yet)' end
              || case when cardinality(v_to) = 0 then '. No orders, shipping or rep email on file: add who it goes to.' else '' end,
            o.id, v_letter);
  end if;

  -- Trevor's hand-off
  v_due := public.next_business_day(now());
  insert into public.tasks (organization_id, title, notes, due_date, remind_at, assigned_to, vendor_id, order_id, auto_key)
  values (o.organization_id,
          left('Ship and receive: ' || coalesce(v.name, 'vendor') || ', ' || v_po, 200),
          'The confirmation is approved. 1) Send the shipping email with our routing instructions (it is ready in Mail › Drafts). '
            || '2) Route the freight. 3) Finish the LS PO. 4) When it arrives, check it in and click Mark received.',
          v_due, (v_due + time '09:00') at time zone 'America/Los_Angeles', v_who, v.id, o.id, 'ship:' || o.id)
  on conflict (organization_id, auto_key) where auto_key is not null do nothing
  returning id into v_task;
  return v_task;
end;
$$;
revoke execute on function public.order_ship_start(uuid) from public, anon, authenticated;
grant execute on function public.order_ship_start(uuid) to service_role;

-- A person confirming the order starts it (imports and the web-order auto-confirm don't).
create or replace function public.orders_ship_start() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'confirmed' and (tg_op = 'INSERT' or old.status is distinct from 'confirmed') and auth.uid() is not null then
    perform public.order_ship_start(new.id);
  end if;
  return null;
end;
$$;
drop trigger if exists orders_ship_start on public.orders;
create trigger orders_ship_start after insert or update of status on public.orders
  for each row execute function public.orders_ship_start();

-- Received (or further along, or cancelled): Trevor's task closes.
create or replace function public.orders_ship_done() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.status in ('received', 'entered', 'ready_to_pay', 'paid', 'cancelled') and old.status is distinct from new.status then
    update public.tasks set done_at = now(), done_by = auth.uid(), done_note = case when new.status = 'cancelled' then 'Order cancelled' else 'Received' end
     where organization_id = new.organization_id and auto_key = 'ship:' || new.id and done_at is null;
  end if;
  return null;
end;
$$;
drop trigger if exists orders_ship_done on public.orders;
create trigger orders_ship_done after update of status on public.orders
  for each row execute function public.orders_ship_done();

-- The buttons on the order's Shipping & receiving box (editors).
create or replace function public.order_ship_action(p_order uuid, p_action text) returns uuid
language plpgsql security definer set search_path = public as $$
declare o public.orders%rowtype;
begin
  select * into o from public.orders where id = p_order;
  if o.id is null or not public.user_in_org(o.organization_id) or not public.user_can_edit() then raise exception 'Order not found' using errcode = '23503'; end if;
  if p_action = 'start' then
    if o.status <> 'confirmed' then raise exception 'The order is not confirmed yet' using errcode = '22023'; end if;
    return public.order_ship_start(o.id);
  elsif p_action = 'received' then
    if o.status not in ('open', 'awaiting_confirmation', 'confirmed', 'shipped') then raise exception 'This order is already past receiving' using errcode = '22023'; end if;
    update public.orders set status = 'received', date_received = coalesce(date_received, current_date) where id = o.id;
    return null;
  end if;
  raise exception 'Unknown action %', p_action using errcode = '22023';
end;
$$;
revoke execute on function public.order_ship_action(uuid, text) from public, anon;
grant execute on function public.order_ship_action(uuid, text) to authenticated;

-- gmail-send stamps the order once the shipping email is out (and files the email to the order).
create or replace function public.order_ship_email_sent(p_order uuid, p_email uuid) returns void
language sql security definer set search_path = public as $$
  update public.orders set ship_email_sent_at = coalesce(ship_email_sent_at, now()), ship_email_id = coalesce(ship_email_id, p_email) where id = p_order;
  update public.emails set order_id = coalesce(order_id, p_order) where id = p_email;
$$;
revoke execute on function public.order_ship_email_sent(uuid, uuid) from public, anon, authenticated;
grant execute on function public.order_ship_email_sent(uuid, uuid) to service_role;

-- A routing letter uploaded later is attached to the shipping emails still waiting in Drafts.
create or replace function public.routing_letters_attach_waiting() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  update public.email_drafts set attach_routing_letter = true,
         body = replace(body, 'freight routing instructions.', 'freight routing instructions (attached).'),
         note = replace(note, ' (no routing letter uploaded yet)', ' (the routing letter is attached when it sends)')
   where organization_id = new.organization_id and order_id is not null and not attach_routing_letter;
  return null;
end;
$$;
drop trigger if exists routing_letters_attach_waiting on public.routing_letters;
create trigger routing_letters_attach_waiting after insert on public.routing_letters
  for each row execute function public.routing_letters_attach_waiting();

-- back-check: confirmed orders today (not web orders) get their shipping email and task
do $$
declare n int := 0; r record;
begin
  for r in select o.id from public.orders o join public.vendors v on v.id = o.vendor_id where o.status = 'confirmed' and not v.web_orders loop
    if public.order_ship_start(r.id) is not null then n := n + 1; end if;
  end loop;
  raise notice 'ship back-check: % confirmed orders handed to logistics', n;
end $$;
