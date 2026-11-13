-- 0376 — Orders that ship in several shipments (Dana, Nov 13, World Famous Sports: "as the wfs orders come in, and the
-- invoice continues to match the invoice number of previous ones with the appended -2, -3, -4, etc vms needs to keep
-- referencing the confirmation from that season's order, or orders and matching the product until we have received all
-- items in" … "Ok go").
--   • vendors.ships_in_parts: for such a vendor an invoice is a shipment, never the whole order.
--   • order_shipments: one row per invoice on the order (Worldwide's invoice, or the vendor's invoice paper), with its date,
--     amount, units, and the running count against the confirmation.
--   • order_tally(p_order): the confirmation's lines (Claude's reading of the confirmation on the order, else the order's own
--     lines) against every invoice's lines so far: ordered, received, still to come, per item.
--   • order_shipments_sync(p_order): makes the shipments, and sets the order Shipped (in part) while items remain, Received
--     as of the last shipment when nothing does. The close-out hands such vendors' orders here instead of step 1.
--   • Every date is the paper's (Dana: "the back check follows my rule of marking things with actual date it happened").
set local lock_timeout = '5s';

alter table public.vendors add column if not exists ships_in_parts boolean not null default false;
comment on column public.vendors.ships_in_parts is 'Ships one order in several shipments (WFS; Dana, Nov 13): an invoice is a shipment, the order stays on order until the confirmation is filled.';
update public.vendors set ships_in_parts = true where name ilike 'world famous sports%' and not ships_in_parts;

create table if not exists public.order_shipments (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations(id) on delete cascade,
  order_id         uuid not null references public.orders(id) on delete cascade,
  seq              integer not null default 1,
  invoice_key      text not null,
  invoice_number   text,
  wwd_invoice_id   uuid references public.wwd_invoices(id) on delete set null,
  vendor_link_id   uuid references public.vendor_links(id) on delete set null,
  shipped_on       date,
  amount           numeric(12,2),
  units            numeric(12,2) not null default 0,
  received_so_far  numeric(12,2) not null default 0,
  ordered_total    numeric(12,2) not null default 0,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (order_id, invoice_key)
);
comment on table public.order_shipments is 'One row per invoice on an order that ships in parts (Dana, Nov 13): the shipment''s date, amount, units, and the running count against the confirmation.';
create index if not exists order_shipments_order_idx on public.order_shipments (order_id, seq);
alter table public.order_shipments enable row level security;
drop policy if exists order_shipments_read on public.order_shipments;
create policy order_shipments_read on public.order_shipments for select to authenticated using (public.user_in_org(organization_id));
grant select on public.order_shipments to authenticated;
grant all on public.order_shipments to service_role;

create or replace function public.item_key(p text) returns text language sql immutable as $$ select nullif(upper(regexp_replace(coalesce(p, ''), '[^A-Za-z0-9]', '', 'g')), '') $$;
grant execute on function public.item_key(text) to authenticated, service_role;

-- ---- the confirmation against every invoice so far -----------------------------------------------------------------------
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
  ), got as (
    select public.item_key(x.vendor_item_id) as k, max(x.vendor_item_id) as vid, max(nullif(x.description, '')) as d, sum(coalesce(x.quantity, 0)) as q
      from (select vendor_item_id, description, quantity from wwd union all select vendor_item_id, description, quantity from chk) x
     where public.item_key(x.vendor_item_id) is not null group by 1
  )
  select coalesce(conf.k, got.k), coalesce(conf.vid, got.vid), coalesce(conf.d, got.d), coalesce(conf.q, 0), coalesce(got.q, 0), greatest(coalesce(conf.q, 0) - coalesce(got.q, 0), 0), conf.k is not null
    from conf full outer join got on got.k = conf.k
   order by (conf.k is null), coalesce(conf.vid, got.vid);
end $$;
revoke execute on function public.order_tally(uuid) from public, anon;
grant execute on function public.order_tally(uuid) to authenticated, service_role;

-- ---- the shipments and the order's state --------------------------------------------------------------------------------
create or replace function public.order_shipments_sync(p_order uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare o record; v_parts boolean; r record; v_seq integer := 0; v_cum numeric := 0; v_ordered numeric; v_received numeric; v_left numeric; v_last date; v_n integer := 0; v_units numeric;
begin
  select ord.*, v.ships_in_parts into o from public.orders ord join public.vendors v on v.id = ord.vendor_id where ord.id = p_order;
  if o.id is null then return '{}'::jsonb; end if;
  -- the invoices on the order, Worldwide's first, each the vendor's own paper when Worldwide has none
  for r in
    select * from (
      select public.item_key(coalesce(w.vendor_invoice_number, w.seq)) as k, coalesce(w.vendor_invoice_number, w.seq) as num, w.id as wid, null::uuid as lid, w.wwd_date as on_day, w.amount,
             (select coalesce(sum(l.quantity), 0) from public.wwd_invoice_lines l where l.invoice_id = w.id and not coalesce(l.is_freight, false)) as units
        from public.wwd_invoices w where w.order_id = p_order and w.kind = 'invoice'
      union all
      select public.item_key(l.doc_number), l.doc_number, null, l.id, coalesce(l.doc_date, l.received_at), l.doc_total,
             (select coalesce(sum((x->>'quantity')::numeric), 0) from public.order_checks c, jsonb_array_elements(coalesce(c.reading->'lines', '[]'::jsonb)) x
               where c.order_id = p_order and c.kind = 'invoice' and public.item_key(c.doc_number) = public.item_key(l.doc_number))
        from public.vendor_links l where l.order_id = p_order and l.kind = 'invoice' and public.item_key(l.doc_number) is not null
         and public.item_key(l.doc_number) not in (select public.item_key(coalesce(w2.vendor_invoice_number, w2.seq)) from public.wwd_invoices w2 where w2.order_id = p_order and w2.kind = 'invoice')
    ) s where s.k is not null order by s.on_day nulls last, s.num
  loop
    v_seq := v_seq + 1; v_cum := v_cum + coalesce(r.units, 0); v_n := v_n + 1;
    insert into public.order_shipments (organization_id, order_id, seq, invoice_key, invoice_number, wwd_invoice_id, vendor_link_id, shipped_on, amount, units, received_so_far)
    values (o.organization_id, p_order, v_seq, r.k, r.num, r.wid, r.lid, r.on_day, r.amount, coalesce(r.units, 0), v_cum)
    on conflict (order_id, invoice_key) do update set seq = excluded.seq, invoice_number = excluded.invoice_number, wwd_invoice_id = coalesce(excluded.wwd_invoice_id, order_shipments.wwd_invoice_id),
      vendor_link_id = coalesce(excluded.vendor_link_id, order_shipments.vendor_link_id), shipped_on = coalesce(excluded.shipped_on, order_shipments.shipped_on), amount = coalesce(excluded.amount, order_shipments.amount),
      units = excluded.units, received_so_far = excluded.received_so_far, updated_at = now();
    v_last := greatest(coalesce(v_last, r.on_day), r.on_day);
  end loop;
  if v_n = 0 then return jsonb_build_object('shipments', 0); end if;
  select coalesce(sum(t.ordered), 0), coalesce(sum(least(t.received, t.ordered)), 0), coalesce(sum(t.still), 0) into v_ordered, v_received, v_left from public.order_tally(p_order) t where t.on_confirmation;
  update public.order_shipments set ordered_total = v_ordered where order_id = p_order;
  v_parts := o.ships_in_parts or v_n > 1;
  if o.status in ('open', 'awaiting_confirmation', 'confirmed', 'shipped') then
    if v_parts and (v_ordered = 0 or v_left > 0) then
      -- shipped in part: on order until the confirmation is filled (or there is no item list to fill)
      if o.status <> 'shipped' then
        update public.orders set status = 'shipped',
               notes = concat_ws(E'\n', nullif(notes, ''), case when v_ordered = 0 then format('Shipped in part: %s shipment(s) so far, the first %s. VMS has no item list from a confirmation to check them against, so it stays on order until someone marks it received.', v_n, to_char((select min(shipped_on) from public.order_shipments where order_id = p_order), 'Mon FMDD, YYYY'))
                                                                else format('Shipped in part: %s shipment(s) so far, %s of %s items in, %s still to come (against the confirmation).', v_n, v_received, v_ordered, v_left) end)
         where id = p_order;
        perform public.order_history_date(p_order, 'shipped', ((select min(shipped_on) from public.order_shipments where order_id = p_order)::timestamp + time '12:00') at time zone 'America/Los_Angeles');
      end if;
    else
      update public.orders set status = 'received', date_received = coalesce(date_received, v_last),
             notes = concat_ws(E'\n', nullif(notes, ''), format('Received as of %s: %s shipment(s), %s of %s items in against the confirmation. VMS closed it out on %s.', to_char(v_last, 'Mon FMDD, YYYY'), v_n, v_received, v_ordered, to_char(now() at time zone 'America/Los_Angeles', 'Mon FMDD, YYYY')))
       where id = p_order;
      perform public.order_history_date(p_order, 'received', (v_last::timestamp + time '12:00') at time zone 'America/Los_Angeles');
    end if;
  end if;
  return jsonb_build_object('shipments', v_n, 'ordered', v_ordered, 'received', v_received, 'still', v_left);
end $$;
revoke execute on function public.order_shipments_sync(uuid) from public, anon, authenticated;
grant execute on function public.order_shipments_sync(uuid) to service_role;

-- ---- the close-out: such vendors' orders go to the shipments sync, not to step 1 ------------------------------------------
create or replace function public.orders_closeout(p_org uuid default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare r record; v_received integer := 0; v_paid integer := 0; v_tied integer := 0; v_bc integer := 0; v_parts integer := 0; org record;
begin
  for org in select id from public.organizations where p_org is null or id = p_org loop
    v_tied := v_tied + public.wwd_invoices_tie_suffix(org.id);

    -- 0. a received date is already on the order (the sheet, a person): it is received as of that day
    for r in
      select o.id, o.date_received from public.orders o
       where o.organization_id = org.id and o.status in ('open', 'awaiting_confirmation', 'confirmed', 'shipped') and o.date_received is not null
    loop
      update public.orders set status = 'received',
             notes = concat_ws(E'\n', nullif(notes, ''), format('Received as of %s (the received date on the order). VMS closed it out on %s.', to_char(r.date_received, 'Mon FMDD, YYYY'), to_char(now() at time zone 'America/Los_Angeles', 'Mon FMDD, YYYY')))
       where id = r.id;
      perform public.order_history_date(r.id, 'received', (r.date_received::timestamp + time '12:00') at time zone 'America/Los_Angeles');
      v_received := v_received + 1;
    end loop;

    -- 1a. a vendor who ships in parts: shipments against the confirmation
    for r in
      select o.id from public.orders o join public.vendors v on v.id = o.vendor_id
       where o.organization_id = org.id and v.ships_in_parts and o.status in ('open', 'awaiting_confirmation', 'confirmed', 'shipped')
         and (exists (select 1 from public.wwd_invoices w where w.order_id = o.id and w.kind = 'invoice')
              or exists (select 1 from public.vendor_links l where l.order_id = o.id and l.kind = 'invoice'))
    loop
      perform public.order_shipments_sync(r.id);
      v_parts := v_parts + 1;
    end loop;

    -- 1b. received: WWD billed the shipment, or the vendor's invoice is on file
    for r in
      select o.id, o.po_number,
             (select min(w.wwd_date) from public.wwd_invoices w where w.order_id = o.id and w.kind = 'invoice') as wwd_on,
             (select string_agg(coalesce(w.vendor_invoice_number, w.seq), ', ' order by w.wwd_date) from public.wwd_invoices w where w.order_id = o.id and w.kind = 'invoice') as wwd_nos,
             (select min(coalesce(l.doc_date, l.received_at)) from public.vendor_links l where l.order_id = o.id and l.kind = 'invoice') as inv_on,
             (select string_agg(coalesce(l.doc_number, l.file_name), ', ') from public.vendor_links l where l.order_id = o.id and l.kind = 'invoice') as inv_nos
        from public.orders o join public.vendors v on v.id = o.vendor_id
       where o.organization_id = org.id and not v.ships_in_parts and o.status in ('open', 'awaiting_confirmation', 'confirmed', 'shipped')
         and (exists (select 1 from public.wwd_invoices w where w.order_id = o.id and w.kind = 'invoice')
              or exists (select 1 from public.vendor_links l where l.order_id = o.id and l.kind = 'invoice'))
    loop
      update public.orders set status = 'received', date_received = coalesce(date_received, r.wwd_on, r.inv_on),
             notes = concat_ws(E'\n', nullif(notes, ''),
               case when r.wwd_on is not null then format('Received as of %s: Worldwide billed the shipment (invoice %s). VMS closed it out on %s.', to_char(coalesce(r.wwd_on, r.inv_on), 'Mon FMDD, YYYY'), r.wwd_nos, to_char(now() at time zone 'America/Los_Angeles', 'Mon FMDD, YYYY'))
                    else format('Received as of %s: the vendor''s invoice %s is on file. VMS closed it out on %s.', to_char(r.inv_on, 'Mon FMDD, YYYY'), r.inv_nos, to_char(now() at time zone 'America/Los_Angeles', 'Mon FMDD, YYYY')) end)
       where id = r.id;
      perform public.order_history_date(r.id, 'received', ((coalesce(r.wwd_on, r.inv_on))::timestamp + time '12:00') at time zone 'America/Los_Angeles');
      v_received := v_received + 1;
    end loop;

    -- 2. paid: every WWD invoice on the order is paid
    for r in
      select o.id,
             (select max(coalesce(w.paid_date, w.sheet_paid_date)) from public.wwd_invoices w where w.order_id = o.id and w.kind = 'invoice') as paid_on,
             (select sum(coalesce(w.paid_amount, w.amount)) from public.wwd_invoices w where w.order_id = o.id and w.kind = 'invoice') as amt,
             (select string_agg(coalesce(w.vendor_invoice_number, w.seq), ', ' order by w.wwd_date) from public.wwd_invoices w where w.order_id = o.id and w.kind = 'invoice') as nos
        from public.orders o
       where o.organization_id = org.id and o.status in ('received', 'entered', 'ready_to_pay')
         and exists (select 1 from public.wwd_invoices w where w.order_id = o.id and w.kind = 'invoice')
         and not exists (select 1 from public.wwd_invoices w where w.order_id = o.id and w.kind = 'invoice' and w.paid_date is null and w.sheet_paid_date is null)
    loop
      update public.orders set status = 'paid', paid_date = coalesce(paid_date, r.paid_on), paid_via = coalesce(paid_via, 'wwd'),
             final_cost = coalesce(final_cost, r.amt),
             notes = concat_ws(E'\n', nullif(notes, ''), format('Paid %s through Worldwide (invoice %s%s). VMS closed it out on %s.', to_char(r.paid_on, 'Mon FMDD, YYYY'), r.nos, coalesce(', $' || to_char(r.amt, 'FM999,999,990.00'), ''), to_char(now() at time zone 'America/Los_Angeles', 'Mon FMDD, YYYY')))
       where id = r.id;
      perform public.order_history_date(r.id, 'paid', (r.paid_on::timestamp + time '12:00') at time zone 'America/Los_Angeles');
      v_paid := v_paid + 1;
    end loop;

    -- 3. paid in Bill.com
    v_bc := v_bc + public.billcom_orders_paid(org.id);
  end loop;
  return jsonb_build_object('received', v_received, 'in_parts', v_parts, 'paid_wwd', v_paid, 'paid_billcom', v_bc, 'invoices_tied', v_tied);
end $$;
revoke execute on function public.orders_closeout(uuid) from public, anon, authenticated;
grant execute on function public.orders_closeout(uuid) to service_role;

-- ---- today's close-out under the old rule, undone for vendors who ship in parts, then judged again -------------------------
do $$
declare r record; h record;
begin
  for r in
    select o.id, o.notes from public.orders o join public.vendors v on v.id = o.vendor_id
     where v.ships_in_parts and o.status = 'received' and o.notes like '%Worldwide billed the shipment%VMS closed it out on Nov 13, 2026.%'
  loop
    select * into h from public.order_status_history where order_id = r.id and to_status = 'received' order by changed_at desc limit 1;
    if h.id is not null and h.from_status is not null then
      update public.orders set status = h.from_status, date_received = null,
             notes = regexp_replace(r.notes, E'\n?Received as of [^\n]*Worldwide billed the shipment[^\n]*VMS closed it out on Nov 13, 2026\\.', '', 'g')
       where id = r.id;
      delete from public.order_status_history where id = h.id;
      -- the status trigger wrote a new row for the step back: it is not history, remove it too
      delete from public.order_status_history where order_id = r.id and to_status = h.from_status and changed_at > now() - interval '1 minute';
    end if;
  end loop;
end $$;
-- every order of such a vendor with invoices on it gets its shipments (received and paid ones too, for the record)
do $$ declare r record; begin
  for r in select o.id from public.orders o join public.vendors v on v.id = o.vendor_id where v.ships_in_parts and o.status <> 'cancelled'
            and (exists (select 1 from public.wwd_invoices w where w.order_id = o.id and w.kind = 'invoice') or exists (select 1 from public.vendor_links l where l.order_id = o.id and l.kind = 'invoice'))
  loop perform public.order_shipments_sync(r.id); end loop;
end $$;
do $$ declare r jsonb; begin r := public.orders_closeout(); raise notice 'close-out: %', r; end $$;
