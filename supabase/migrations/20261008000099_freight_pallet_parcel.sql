-- 0099 — Pallet or parcel (Dana, Oct 13): "If it is palletized it goes by truck with P1, if its smaller boxes it goes
-- parcel, UPS with WWEX." Each freight quote ships one way: Pallet (P1) — Trevor gets a Priority One price only — or
-- Parcel (WWEX/UPS) — a UPS price through WWEX only. Claude picks it from the vendor's quote (pallets or boxes); Trevor
-- can switch it. The task says which: "Get freight quote: Sona, PO 1234 – Pallet, P1".

alter table public.freight_quotes add column if not exists ships_by text check (ships_by in ('pallet', 'parcel'));
comment on column public.freight_quotes.ships_by is 'pallet: Priority One (truck); parcel: UPS through WWEX (Dana, Oct 13). Null until known.';

-- Pallet or parcel from Claude's reading: its own answer, else pallets listed → pallet, only cartons → parcel.
create or replace function public.freight_ships_by(p_reading jsonb)
returns text language sql immutable as $$
  select case
    when p_reading->>'ships_by' in ('pallet', 'parcel') then p_reading->>'ships_by'
    when jsonb_typeof(p_reading->'details'->'pallets') = 'array' and jsonb_array_length(p_reading->'details'->'pallets') > 0 then 'pallet'
    when jsonb_typeof(p_reading->'details'->'cartons') = 'array' and jsonb_array_length(p_reading->'details'->'cartons') > 0 then 'parcel'
    when coalesce(p_reading->'details'->>'cartons', '') ~ '^[1-9][0-9]*$' then 'parcel'
  end
$$;

-- "Get freight quote: Sona, PO 1234 – Pallet, P1"
create or replace function public.freight_task_title(p_vendor text, p_po text, p_needs_order boolean, p_ships_by text)
returns text language sql immutable as $$
  select left('Get freight quote: ' || coalesce(p_vendor, 'vendor')
              || case when p_needs_order then ', which order?' when p_po is not null then ', PO ' || p_po else '' end
              || case p_ships_by when 'pallet' then ' – Pallet, P1' when 'parcel' then ' – Parcel, WWEX/UPS' else '' end, 200)
$$;
grant execute on function public.freight_ships_by(jsonb), public.freight_task_title(text, text, boolean, text) to authenticated, service_role;

-- Existing quotes: pallet or parcel from what was read.
update public.freight_quotes set ships_by = public.freight_ships_by(jsonb_build_object('details', details)) where ships_by is null;

create or replace function public.freight_quote_apply(p_email uuid, p_is_quote boolean, p_reading jsonb, p_vendor uuid, p_order uuid, p_how text)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  e      public.emails%rowtype;
  v_id   uuid;
  v_task uuid;
  v_name text;
  v_po   text;
  v_who  uuid;
  v_due  date;
  v_by   text;
begin
  select * into e from public.emails where id = p_email;
  if e.id is null then return null; end if;
  update public.emails set freight_scan_at = now() where id = p_email;
  if not p_is_quote then return null; end if;
  if p_order is not null then
    select coalesce(p_vendor, vendor_id), po_number into p_vendor, v_po from public.orders where id = p_order;
  end if;
  select name into v_name from public.vendors where id = p_vendor;
  v_by := public.freight_ships_by(p_reading);
  insert into public.freight_quotes (organization_id, vendor_id, order_id, email_id, thread_id, status, match_how,
                                     vendor_carrier, vendor_service, vendor_cost, transit, details, ships_by)
  values (e.organization_id, p_vendor, p_order, e.id, e.thread_id, case when p_order is null then 'needs_order' else 'waiting' end,
          case when p_order is null then null else p_how end,
          nullif(p_reading->>'carrier', ''), nullif(p_reading->>'service', ''),
          case when coalesce(p_reading->>'cost', '') ~ '^[0-9]+(\.[0-9]+)?$' then (p_reading->>'cost')::numeric end,
          nullif(p_reading->>'transit', ''), coalesce(p_reading->'details', '{}'::jsonb), v_by)
  on conflict (email_id) do nothing
  returning id into v_id;
  if v_id is null then return null; end if;
  if p_order is not null then update public.emails set order_id = coalesce(order_id, p_order) where id = p_email; end if;

  v_who := public.freight_assignee(e.organization_id);
  v_due := public.next_business_day(e.received_at);
  insert into public.tasks (organization_id, title, notes, due_date, remind_at, assigned_to, vendor_id, order_id, thread_id, auto_key)
  values (e.organization_id,
          public.freight_task_title(v_name, v_po, p_order is null, v_by),
          case v_by when 'pallet' then 'Pallet: get a Priority One price, then approve the cheaper one on the freight quote (Freight › Freight quotes).'
                    when 'parcel' then 'Parcel: get a UPS price through WWEX, then approve the cheaper one on the freight quote (Freight › Freight quotes).'
                    else 'Pallet → Priority One; parcel (boxes) → UPS through WWEX. Get that price, then approve the cheaper one (Freight › Freight quotes).' end,
          v_due, (v_due + time '09:00') at time zone 'America/Los_Angeles', v_who, p_vendor, p_order, e.thread_id, 'freight_quote:' || v_id)
  on conflict (organization_id, auto_key) where auto_key is not null do nothing
  returning id into v_task;
  update public.freight_quotes set task_id = v_task where id = v_id;
  return v_id;
end;
$$;

create or replace function public.freight_quote_action(p_quote uuid, p_action text, p_order uuid default null,
  p_priority_one numeric default null, p_wwex numeric default null, p_note text default null, p_choice text default null, p_cost numeric default null)
returns void language plpgsql security definer set search_path = public as $$
declare
  q public.freight_quotes%rowtype;
  o public.orders%rowtype;
  v_name text;
  v_po   text;
begin
  if not public.user_can_edit() then raise exception 'Only admins, managers and buyers handle freight quotes' using errcode = '42501'; end if;
  select * into q from public.freight_quotes where id = p_quote for update;
  if q.id is null or not public.user_in_org(q.organization_id) then raise exception 'Freight quote not found' using errcode = '23503'; end if;
  if p_action = 'set_order' then
    select * into o from public.orders where id = p_order;
    if o.id is null or o.organization_id <> q.organization_id then raise exception 'Order not found' using errcode = '23503'; end if;
    update public.freight_quotes set order_id = o.id, vendor_id = coalesce(vendor_id, o.vendor_id), match_how = 'picked',
           status = case when status = 'needs_order' then 'waiting' else status end where id = p_quote;
    update public.emails set order_id = coalesce(order_id, o.id) where id = q.email_id;
    select name into v_name from public.vendors where id = o.vendor_id;
    update public.tasks set order_id = o.id, vendor_id = o.vendor_id,
           title = public.freight_task_title(v_name, o.po_number, false, q.ships_by)
     where id = q.task_id and done_at is null;
  elsif p_action in ('pallet', 'parcel') then
    update public.freight_quotes set ships_by = p_action where id = p_quote;
    select v.name, o2.po_number into v_name, v_po from public.freight_quotes fq left join public.vendors v on v.id = fq.vendor_id
      left join public.orders o2 on o2.id = fq.order_id where fq.id = p_quote;
    update public.tasks set title = public.freight_task_title(v_name, v_po, q.order_id is null, p_action)
     where id = q.task_id and done_at is null;
  elsif p_action = 'ours' then
    update public.freight_quotes set priority_one_cost = p_priority_one, wwex_cost = p_wwex, our_note = nullif(trim(coalesce(p_note, '')), '') where id = p_quote;
  elsif p_action = 'approve' then
    if q.order_id is null then raise exception 'Pick the order first' using errcode = '22023'; end if;
    if p_choice not in ('vendor', 'priority_one', 'wwex', 'other') then raise exception 'Pick which quote' using errcode = '22023'; end if;
    update public.freight_quotes set status = 'approved', approved_choice = p_choice,
           approved_cost = coalesce(p_cost, case p_choice when 'vendor' then vendor_cost when 'priority_one' then priority_one_cost when 'wwex' then wwex_cost end),
           approved_by = auth.uid(), approved_at = now(), our_note = coalesce(nullif(trim(coalesce(p_note, '')), ''), our_note)
     where id = p_quote returning * into q;
    update public.orders set freight_cost = coalesce(freight_cost, q.approved_cost) where id = q.order_id;
    update public.tasks set done_at = now(), done_by = auth.uid(),
           done_note = 'Approved: ' || case q.approved_choice when 'vendor' then 'the vendor''s quote' when 'priority_one' then 'Priority One' when 'wwex' then 'WWEX' else 'other' end
                       || coalesce(' $' || to_char(q.approved_cost, 'FM999,990.00'), '')
     where id = q.task_id and done_at is null;
  elsif p_action = 'decline' then
    update public.freight_quotes set status = 'declined', our_note = coalesce(nullif(trim(coalesce(p_note, '')), ''), our_note), approved_by = auth.uid(), approved_at = now() where id = p_quote;
    update public.tasks set done_at = now(), done_by = auth.uid(), done_note = 'Not a freight quote' where id = q.task_id and done_at is null;
  elsif p_action = 'reopen' then
    update public.freight_quotes set status = case when order_id is null then 'needs_order' else 'waiting' end, approved_choice = null, approved_cost = null, approved_by = null, approved_at = null where id = p_quote;
    update public.tasks set done_at = null, done_by = null, done_note = null where id = q.task_id;
  else
    raise exception 'Unknown action %', p_action;
  end if;
end;
$$;
