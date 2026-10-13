-- 0117 — Freight quotes (Dana, Oct 13): "on any shipment, I want a quote from the vendor, and all the info required for
-- Trevor to get a quote from Priority 1 or WWEX to see what is cheapest. No order is to be shipped without a freight quote
-- from the vendor." A vendor's freight quote email (from today on) becomes a freight quote on its order and a task for
-- Trevor, "Get freight quote: <vendor>, PO <number>", due the next business day. He adds the Priority One and WWEX
-- prices and approves one; the order shows "Waiting on freight quote" until then.
-- Matching a quote to its order: our PO → the vendor's own order/confirmation/invoice number → the conversation →
-- Claude's comparison with the vendor's open orders (never "only one open order" alone, Dana) → for freight-company mail
-- the ship-from zip → otherwise "which order?" and Trevor picks.

create table if not exists public.freight_quotes (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations(id) on delete cascade,
  vendor_id        uuid references public.vendors(id) on delete set null,
  order_id         uuid references public.orders(id) on delete set null,
  email_id         uuid not null references public.emails(id) on delete cascade,
  thread_id        uuid references public.email_threads(id) on delete set null,
  status           text not null default 'waiting' check (status in ('needs_order', 'waiting', 'approved', 'declined')),
  match_how        text check (match_how in ('po', 'vendor_number', 'conversation', 'claude', 'ship_from', 'picked')),
  vendor_carrier   text,
  vendor_service   text,
  vendor_cost      numeric(12,2),
  transit          text,
  details          jsonb not null default '{}'::jsonb,
  priority_one_cost numeric(12,2),
  wwex_cost        numeric(12,2),
  our_note         text,
  approved_choice  text check (approved_choice in ('vendor', 'priority_one', 'wwex', 'other')),
  approved_cost    numeric(12,2),
  approved_by      uuid references public.profiles(id) on delete set null,
  approved_at      timestamptz,
  task_id          uuid references public.tasks(id) on delete set null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (email_id)
);
comment on table public.freight_quotes is 'A vendor''s freight quote for an order (Dana, Oct 13): their price and the shipment details, our Priority One and WWEX prices, and the one approved.';
create index if not exists freight_quotes_order_idx on public.freight_quotes (order_id);
create index if not exists freight_quotes_status_idx on public.freight_quotes (organization_id, status, created_at desc);
drop trigger if exists freight_quotes_set_updated_at on public.freight_quotes;
create trigger freight_quotes_set_updated_at before update on public.freight_quotes for each row execute function public.set_updated_at();
alter table public.freight_quotes enable row level security;
drop policy if exists "freight_quotes: members read" on public.freight_quotes;
create policy "freight_quotes: members read" on public.freight_quotes for select to authenticated using (public.user_in_org(organization_id));
grant select on table public.freight_quotes to authenticated;
grant all on table public.freight_quotes to service_role;

alter table public.emails add column if not exists freight_scan_at timestamptz;

-- Who gets the freight-quote task: the person whose title says receiving or logistics (Trevor), else the admin.
create or replace function public.freight_assignee(p_org uuid)
returns uuid language sql stable security definer set search_path = public as $$
  select coalesce(
    (select p.id from public.profiles p where p.organization_id = p_org and p.is_active and p.job_title ~* '(logistic|receiving|freight)' order by p.created_at limit 1),
    public.org_admin(p_org))
$$;

-- The next business day (Mon–Fri) after a time, in the store's time zone.
create or replace function public.next_business_day(p_at timestamptz)
returns date language sql stable as $$
  select d from (select (p_at at time zone 'America/Los_Angeles')::date + g as d from generate_series(1, 5) g) x
   where extract(isodow from d) < 6 order by d limit 1
$$;

-- Emails that may be a freight quote: from today on, Orders mail or shared, from a vendor, rep group, freight company or
-- ordering service, about freight, a quote, a pickup or a shipment. Service role only.
create or replace function public.freight_quote_queue(p_org uuid, p_limit integer default 10)
returns table (email_id uuid, thread_id uuid, vendor_id uuid, sender_kind text, from_name text, from_email text, subject text, body_text text, received_at timestamptz, attachments text[])
language sql stable security definer set search_path = public as $$
  select e.id, e.thread_id, coalesce(e.vendor_id, s.vendor_id), s.kind, e.from_name, e.from_email, e.subject, left(coalesce(e.body_text, e.snippet, ''), 6000), e.received_at,
         coalesce((select array_agg(a.file_name) from public.email_attachments a where a.email_id = e.id), '{}')
    from public.emails e
    left join public.email_senders s on s.id = e.sender_id
    left join public.email_threads t on t.id = e.thread_id
   where e.organization_id = p_org and e.direction = 'in' and e.copy_of is null and e.freight_scan_at is null
     and e.received_at >= timestamptz '2026-10-14 00:00 America/Los_Angeles'
     and (e.mailbox_id is null or t.shared_at is not null)
     and coalesce(s.kind, 'unknown') in ('vendor', 'rep_group', 'carrier', 'platform', 'unknown')
     and (coalesce(e.subject, '') || ' ' || left(coalesce(e.body_text, e.snippet, ''), 3000))
         ~* '(freight|quote|ready to ship|ready for pick|pick ?up|cartons|pallets?|dimensions|\mdims\M|ship(ping)? (cost|charge)|routing|bill of lading)'
   order by e.received_at
   limit p_limit
$$;

-- Claude's reading of one email, and the order it belongs to (null: Trevor picks). Service role only.
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
begin
  select * into e from public.emails where id = p_email;
  if e.id is null then return null; end if;
  update public.emails set freight_scan_at = now() where id = p_email;
  if not p_is_quote then return null; end if;
  if p_order is not null then
    select coalesce(p_vendor, vendor_id), po_number into p_vendor, v_po from public.orders where id = p_order;
  end if;
  select name into v_name from public.vendors where id = p_vendor;
  insert into public.freight_quotes (organization_id, vendor_id, order_id, email_id, thread_id, status, match_how,
                                     vendor_carrier, vendor_service, vendor_cost, transit, details)
  values (e.organization_id, p_vendor, p_order, e.id, e.thread_id, case when p_order is null then 'needs_order' else 'waiting' end,
          case when p_order is null then null else p_how end,
          nullif(p_reading->>'carrier', ''), nullif(p_reading->>'service', ''),
          case when coalesce(p_reading->>'cost', '') ~ '^[0-9]+(\.[0-9]+)?$' then (p_reading->>'cost')::numeric end,
          nullif(p_reading->>'transit', ''), coalesce(p_reading->'details', '{}'::jsonb))
  on conflict (email_id) do nothing
  returning id into v_id;
  if v_id is null then return null; end if;
  if p_order is not null then update public.emails set order_id = coalesce(order_id, p_order) where id = p_email; end if;

  v_who := public.freight_assignee(e.organization_id);
  v_due := public.next_business_day(e.received_at);
  insert into public.tasks (organization_id, title, notes, due_date, remind_at, assigned_to, vendor_id, order_id, thread_id, auto_key)
  values (e.organization_id,
          left('Get freight quote: ' || coalesce(v_name, 'vendor') || case when p_order is null then ', which order?' when v_po is not null then ', PO ' || v_po else '' end, 200),
          'Get Priority One and WWEX prices, then approve the cheapest on the freight quote (Freight › Freight quotes).',
          v_due, (v_due + time '09:00') at time zone 'America/Los_Angeles', v_who, p_vendor, p_order, e.thread_id, 'freight_quote:' || v_id)
  on conflict (organization_id, auto_key) where auto_key is not null do nothing
  returning id into v_task;
  update public.freight_quotes set task_id = v_task where id = v_id;
  return v_id;
end;
$$;

revoke execute on function public.freight_quote_queue(uuid, integer), public.freight_quote_apply(uuid, boolean, jsonb, uuid, uuid, text), public.freight_assignee(uuid) from public, anon, authenticated;
grant execute on function public.freight_quote_queue(uuid, integer), public.freight_quote_apply(uuid, boolean, jsonb, uuid, uuid, text), public.freight_assignee(uuid) to service_role;
grant execute on function public.next_business_day(timestamptz) to authenticated, service_role;

-- Trevor's buttons: pick the order, our prices, approve or decline.
create or replace function public.freight_quote_action(p_quote uuid, p_action text, p_order uuid default null,
  p_priority_one numeric default null, p_wwex numeric default null, p_note text default null, p_choice text default null, p_cost numeric default null)
returns void language plpgsql security definer set search_path = public as $$
declare
  q public.freight_quotes%rowtype;
  o public.orders%rowtype;
  v_name text;
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
           title = left('Get freight quote: ' || coalesce(v_name, 'vendor') || coalesce(', PO ' || o.po_number, ''), 200)
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
revoke execute on function public.freight_quote_action(uuid, text, uuid, numeric, numeric, text, text, numeric) from public, anon;
grant execute on function public.freight_quote_action(uuid, text, uuid, numeric, numeric, text, text, numeric) to authenticated, service_role;

-- Orders that shipped without an approved freight quote (placed from Oct 14 on, freight not free).
create or replace function public.freight_unapproved_shipments(p_org uuid)
returns table (order_id uuid, vendor_id uuid, vendor_name text, po_number text, order_date date, status text, has_quote boolean)
language sql stable security definer set search_path = public as $$
  select o.id, o.vendor_id, v.name, o.po_number, o.order_date, o.status::text,
         exists (select 1 from public.freight_quotes q where q.order_id = o.id)
    from public.orders o join public.vendors v on v.id = o.vendor_id
   where o.organization_id = p_org and public.user_in_org(p_org)
     and o.status in ('shipped', 'received')
     and coalesce(o.order_date, o.created_at::date) >= date '2026-10-14'
     and o.free_shipping is not true and not v.web_orders
     and not exists (select 1 from public.freight_quotes q where q.order_id = o.id and q.status = 'approved')
   order by o.order_date desc nulls last
$$;
revoke execute on function public.freight_unapproved_shipments(uuid) from public, anon;
grant execute on function public.freight_unapproved_shipments(uuid) to authenticated, service_role;
