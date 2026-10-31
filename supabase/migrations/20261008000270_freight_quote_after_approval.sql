-- 0270 — An order whose freight price is already approved gets no new freight quote or task from later mail (Oct 30:
-- Becker's "Yes it is ready. Dock hours are 7:30 to 3:30 … Will you be sending a BOL?" opened a second "Get freight
-- quote" task for Dana after her $1,043 XPO price was approved). That one is closed.

set local lock_timeout = '5s';

create or replace function public.freight_quote_apply(p_email uuid, p_is_quote boolean, p_reading jsonb, p_vendor uuid, p_order uuid, p_how text)
 returns uuid
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  e      public.emails%rowtype;
  v_id   uuid;
  v_task uuid;
  v_name text;
  v_po   text;
  v_who  uuid;
  v_due  date;
  v_by   text;
  v_priv boolean;
begin
  select * into e from public.emails where id = p_email;
  if e.id is null then return null; end if;
  update public.emails set freight_scan_at = now() where id = p_email;
  if not p_is_quote then return null; end if;
  -- the order already has its approved price: a later email (Becker: "Yes it is ready … Will you be sending a BOL?")
  -- opens no new quote or task
  if p_order is not null and exists (select 1 from public.freight_quotes x where x.order_id = p_order and x.status = 'approved') then return null; end if;
  v_priv := e.mailbox_id is not null and not exists (select 1 from public.email_threads t where t.id = e.thread_id and t.shared_at is not null);
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
          nullif(p_reading->>'transit', ''), case when v_priv then '{}'::jsonb else coalesce(p_reading->'details', '{}'::jsonb) end, v_by)
  on conflict (email_id) do nothing
  returning id into v_id;
  if v_id is null then return null; end if;
  if p_order is not null then update public.emails set order_id = coalesce(order_id, p_order) where id = p_email; end if;

  v_who := case when v_priv then (select owner_id from public.mailboxes where id = e.mailbox_id) else public.freight_assignee(e.organization_id) end;
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
$function$;

update public.tasks t set done_at = now(), done_note = 'Not needed: the freight price for this order was already approved (XPO $1,043). This email was Becker saying the order is ready.'
  from public.freight_quotes q where q.id = 'fdb49b3b-1909-48f8-a52d-d30052fc4793' and t.id = q.task_id and t.done_at is null;
update public.freight_quotes set status = 'declined', our_note = 'Not a quote: the vendor saying the order is ready.' where id = 'fdb49b3b-1909-48f8-a52d-d30052fc4793' and status = 'waiting';
