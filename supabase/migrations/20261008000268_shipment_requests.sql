-- 0268 — Shipment details and freight quote in one email, as soon as an order is confirmed (Dana, Oct 30).
-- "We create an online form that we email to each vendor with instructions as soon as an order is confirmed … a task and
-- notification for Trevor if he has not heard back from the vendor within 3 business days … I just want it streamlined."
--
--   • orders.freight_terms (free / half / capped / charged, with the cap %), what we agreed when the order was placed.
--     The confirmation is checked against it: free freight shown → confirmed, nothing goes out; the agreed terms not
--     shown → the matching check email; charged → the shipment details email with the form link.
--   • shipment_requests: one per confirmed order. Who it goes to (Dana: "I would rather email too many people than have
--     it go to the wrong one"): the person who sent us the confirmation, cc the Shipping contact and our rep.
--     VMS sends it itself from orders@ as Trevor (Inventory & Logistics Specialist); the edge function shipment-requests
--     sends 'ready' rows every 5 minutes. The Oct 20 placeholder shipping email is replaced by this one (the routing
--     letter attached).
--   • The form (no login): Pallet (LTL) or Parcel (UPS/FedEx), pickup location, contact, hours, ready date, the pallets
--     or packages (as many as they have), their quote. Answers become a freight quote for Trevor (Freight › Freight
--     quotes) and show on the order. A reply by email is read by Claude and lands the same way.
--   • 3 business days with no form and no reply: a task for Trevor with the follow-up email ready in his Drafts.
--   • A "freight will be charged" reply to a free / half / capped check: a task for whoever placed the order, Trevor
--     cc'd (an FYI task), the conversation handed to the buyer. "Yes, free" confirms the terms on the order.
--   • Orders already confirmed today get a request on hold (not sent until Dana says).

set local lock_timeout = '5s';

-- ---- what we agreed on freight -------------------------------------------------------------------------------------
alter table public.orders add column if not exists freight_terms text check (freight_terms in ('free', 'half', 'capped', 'charged'));
alter table public.orders add column if not exists freight_cap_pct numeric(5,2) check (freight_cap_pct is null or (freight_cap_pct > 0 and freight_cap_pct <= 100));
alter table public.orders add column if not exists freight_terms_confirmed_at timestamptz;
alter table public.orders add column if not exists freight_terms_confirmed_how text check (freight_terms_confirmed_how in ('confirmation', 'reply', 'person'));
alter table public.orders add column if not exists freight_terms_email_id uuid references public.emails(id) on delete set null;
comment on column public.orders.freight_terms is 'What we agreed on freight when the order was placed (Dana, Oct 30): free, half, capped at freight_cap_pct, or charged. Null = free when free_shipping, else charged.';
comment on column public.orders.freight_terms_confirmed_at is 'The vendor confirmed the agreed terms (on the confirmation, by reply, or a person ticked it).';
update public.profiles set job_title = 'Inventory & Logistics Specialist' where email = 'trevor@shaverlakesports.com' and (job_title is null or job_title = 'Receiving & Logistics');

/** The agreed terms, with the old free-shipping tick as the fallback. */
create or replace function public.order_freight_terms(p_order public.orders) returns text language sql immutable as $$
  select coalesce(p_order.freight_terms, case when p_order.free_shipping then 'free' else 'charged' end)
$$;
grant execute on function public.order_freight_terms(public.orders) to authenticated, service_role;

-- a freight quote may come from the form instead of an email
alter table public.freight_quotes alter column email_id drop not null;
alter table public.freight_quotes add column if not exists shipment_request_id uuid;

/** N business days (Mon–Fri) after a time, same clock time, in the store's time zone. */
create or replace function public.add_business_days(p_at timestamptz, p_days integer) returns timestamptz language plpgsql immutable as $$
declare d date := (p_at at time zone 'America/Los_Angeles')::date; n integer := 0;
begin
  while n < p_days loop
    d := d + 1;
    if extract(isodow from d) < 6 then n := n + 1; end if;
  end loop;
  return (d + (p_at at time zone 'America/Los_Angeles')::time) at time zone 'America/Los_Angeles';
end $$;
grant execute on function public.add_business_days(timestamptz, integer) to authenticated, service_role;

-- ---- the requests ---------------------------------------------------------------------------------------------------
create table if not exists public.shipment_requests (
  id                 uuid primary key default gen_random_uuid(),
  organization_id    uuid not null references public.organizations(id) on delete cascade,
  order_id           uuid not null references public.orders(id) on delete cascade unique,
  vendor_id          uuid not null references public.vendors(id) on delete cascade,
  kind               text not null check (kind in ('details', 'free_check', 'half_check', 'cap_check')),
  token              uuid not null default gen_random_uuid() unique,
  status             text not null default 'ready' check (status in ('ready', 'sent', 'opened', 'answered', 'confirmed', 'disputed', 'skipped', 'cancelled')),
  hold               boolean not null default false,
  skip_reason        text,
  to_emails          text[] not null default '{}',
  cc_emails          text[] not null default '{}',
  send_as            uuid references public.profiles(id) on delete set null,
  reply_to_email_id  uuid references public.emails(id) on delete set null,
  sent_email_id      uuid references public.emails(id) on delete set null,
  thread_id          uuid references public.email_threads(id) on delete set null,
  sent_at            timestamptz,
  opened_at          timestamptz,
  answered_at        timestamptz,
  answered_how       text check (answered_how in ('form', 'email')),
  reply_email_id     uuid references public.emails(id) on delete set null,
  last_reply_read_at timestamptz,
  method             text check (method in ('pallet', 'parcel')),
  answers            jsonb not null default '{}'::jsonb,
  quote_id           uuid references public.freight_quotes(id) on delete set null,
  followup_due_at    timestamptz,
  followup_task_id   uuid references public.tasks(id) on delete set null,
  followup_draft_id  uuid references public.email_drafts(id) on delete set null,
  dispute_task_id    uuid references public.tasks(id) on delete set null,
  note               text,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
comment on table public.shipment_requests is 'The shipment details / freight email VMS sends the vendor when an order is confirmed, and what came back (Dana, Oct 30).';
create index if not exists shipment_requests_org_status on public.shipment_requests (organization_id, status);
create index if not exists shipment_requests_vendor on public.shipment_requests (vendor_id);
alter table public.shipment_requests enable row level security;
drop policy if exists shipment_requests_read on public.shipment_requests;
create policy shipment_requests_read on public.shipment_requests for select to authenticated using (public.user_in_org(organization_id));
drop policy if exists shipment_requests_edit on public.shipment_requests;
create policy shipment_requests_edit on public.shipment_requests for update to authenticated using (public.user_in_org(organization_id) and public.user_can_edit()) with check (public.user_in_org(organization_id));
grant select, update on public.shipment_requests to authenticated;
grant all on public.shipment_requests to service_role;
drop trigger if exists shipment_requests_touch on public.shipment_requests;
create trigger shipment_requests_touch before update on public.shipment_requests for each row execute function public.set_updated_at();
alter table public.freight_quotes drop constraint if exists freight_quotes_shipment_request_id_fkey;
alter table public.freight_quotes add constraint freight_quotes_shipment_request_id_fkey foreign key (shipment_request_id) references public.shipment_requests(id) on delete set null;
do $$ begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') and not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'shipment_requests') then
    alter publication supabase_realtime add table public.shipment_requests;
  end if;
end $$;

-- ---- who it goes to -------------------------------------------------------------------------------------------------
-- To: whoever sent us the confirmation; else the Shipping contact, else Orders, else the rep. Cc: the Shipping contacts
-- and our rep's people, whoever is not already in To. Never our own addresses or no-reply boxes.
create or replace function public.shipment_request_recipients(p_order uuid, out to_emails text[], out cc_emails text[], out reply_to uuid)
language plpgsql stable security definer set search_path = public as $$
declare o public.orders%rowtype; v public.vendors%rowtype; ours text[]; v_from text; v_email uuid; v_ship text[]; v_orders text[]; v_rep text[]; v_cc text[];
  bad constant text := '(no-?reply|do-?not-?reply|notification|mailer-daemon)';
begin
  select * into o from public.orders where id = p_order;
  select * into v from public.vendors where id = o.vendor_id;
  select coalesce(array_agg(lower(x)), '{}') into ours from (
    select split_part(mailbox, '@', 2) x from public.mail_accounts where organization_id = o.organization_id
    union select unnest(internal_domains) from public.mail_accounts where organization_id = o.organization_id
    union select 'shaverlakesports.com') d;
  select lower(e.from_email), e.id into v_from, v_email from public.vendor_links l join public.emails e on e.id = l.email_id
   where l.order_id = o.id and l.kind in ('confirmation', 'approved_proof', 'proof') and e.direction = 'in' and e.from_email is not null
   order by (l.kind = 'confirmation') desc, l.created_at desc limit 1;
  if v_from is not null and (split_part(v_from, '@', 2) = any (ours) or v_from ~* bad) then v_from := null; v_email := null; end if;
  select coalesce(array_agg(distinct lower(email)), '{}') into v_ship from public.vendor_emails
   where vendor_id = v.id and email is not null and former_at is null and bad_email_at is null and ('shipping' = any (roles) or contact_type = 'shipping') and email !~* bad;
  select coalesce(array_agg(distinct lower(email)), '{}') into v_orders from public.vendor_emails
   where vendor_id = v.id and email is not null and former_at is null and bad_email_at is null and ('orders' = any (roles) or contact_type = 'orders') and email !~* bad;
  select coalesce(array_agg(distinct lower(c.email)), '{}') into v_rep from public.rep_group_contacts c
   where c.rep_group_id = v.rep_group_id and c.email is not null and c.former_at is null and c.email !~* bad;
  if v_from is not null then to_emails := array[v_from];
  elsif cardinality(v_ship) > 0 then to_emails := v_ship;
  elsif cardinality(v_orders) > 0 then to_emails := v_orders;
  elsif cardinality(v_rep) > 0 then to_emails := v_rep;
  elsif v.email is not null and v.email !~* bad then to_emails := array[lower(v.email)];
  else to_emails := '{}'; end if;
  select coalesce(array_agg(distinct x), '{}') into v_cc from unnest(v_ship || v_rep) x where not (x = any (to_emails)) and not (split_part(x, '@', 2) = any (ours));
  cc_emails := v_cc;
  reply_to := v_email;
end $$;
revoke execute on function public.shipment_request_recipients(uuid) from public, anon;
grant execute on function public.shipment_request_recipients(uuid) to authenticated, service_role;

-- ---- what the confirmation shows about freight --------------------------------------------------------------------
-- 'free' when the vendor's confirmation shows no freight charge, 'charged' when it shows one, 'unknown' when it says nothing.
create or replace function public.confirmation_freight(p_order uuid) returns text language sql stable security definer set search_path = public as $$
  select case
    when r.f is null then 'unknown'
    when r.f = 0 then 'free'
    else 'charged' end
  from (select case when coalesce(c.reading->>'freight', '') ~ '^-?[0-9]+(\.[0-9]+)?$' then (c.reading->>'freight')::numeric end as f
          from public.order_checks c where c.order_id = p_order and c.kind = 'confirmation' order by c.created_at desc limit 1) r
$$;
revoke execute on function public.confirmation_freight(uuid) from public, anon;
grant execute on function public.confirmation_freight(uuid) to authenticated, service_role;

-- ---- the request, once the order is confirmed --------------------------------------------------------------------
create or replace function public.shipment_request_make(p_order uuid, p_hold boolean default false) returns uuid
language plpgsql security definer set search_path = public as $$
declare o public.orders%rowtype; v public.vendors%rowtype; r record; v_terms text; v_shown text; v_kind text; v_id uuid; v_who uuid; v_po text;
begin
  select * into o from public.orders where id = p_order;
  if o.id is null or o.status <> 'confirmed' or o.vendor_id is null then return null; end if;
  select * into v from public.vendors where id = o.vendor_id;
  if v.web_orders or coalesce(v.no_order_checks, false) then return null; end if;
  select id into v_id from public.shipment_requests where order_id = o.id;
  if v_id is not null then return v_id; end if;
  if exists (select 1 from public.freight_quotes q where q.order_id = o.id and q.status = 'approved') then return null; end if;
  v_terms := public.order_freight_terms(o);
  v_shown := public.confirmation_freight(o.id);
  v_who := coalesce(public.logistics_person(o.organization_id), public.org_admin(o.organization_id));
  v_po := coalesce(nullif(trim(o.po_number), ''), '');
  -- free freight agreed and shown on the confirmation: nothing goes out
  if v_terms = 'free' and v_shown = 'free' then
    update public.orders set freight_terms_confirmed_at = coalesce(freight_terms_confirmed_at, now()), freight_terms_confirmed_how = coalesce(freight_terms_confirmed_how, 'confirmation') where id = o.id;
    insert into public.shipment_requests (organization_id, order_id, vendor_id, kind, status, skip_reason, send_as)
      values (o.organization_id, o.id, o.vendor_id, 'free_check', 'skipped', 'Free freight is shown on the confirmation.', v_who) returning id into v_id;
    return v_id;
  end if;
  v_kind := case v_terms when 'free' then 'free_check' when 'half' then 'half_check' when 'capped' then 'cap_check' else 'details' end;
  select * into r from public.shipment_request_recipients(o.id);
  insert into public.shipment_requests (organization_id, order_id, vendor_id, kind, status, hold, to_emails, cc_emails, reply_to_email_id, send_as, note)
    values (o.organization_id, o.id, o.vendor_id, v_kind, 'ready', p_hold, coalesce(r.to_emails, '{}'), coalesce(r.cc_emails, '{}'), r.reply_to, v_who,
            case when cardinality(coalesce(r.to_emails, '{}')) = 0 then 'No email on file for this vendor: add one on the vendor page and VMS sends it.' end)
    returning id into v_id;
  -- the Oct 20 placeholder shipping email is replaced by this one
  delete from public.email_drafts where order_id = o.id and gmail_draft_id is null and subject like 'Shipping instructions for %';
  if cardinality(coalesce(r.to_emails, '{}')) = 0 and v_who is not null then
    insert into public.tasks (organization_id, title, notes, due_date, remind_at, assigned_to, vendor_id, order_id, auto_key)
    values (o.organization_id, left('No email for ' || coalesce(v.name, 'the vendor') || case when v_po <> '' then ', PO ' || v_po else '' end || ': add one and VMS sends the shipment form', 200),
            'VMS could not find who to send the shipment details email to. Add the vendor''s Shipping or Orders contact (or the rep) on the vendor page; the email goes out on its own within a few minutes.',
            current_date, now(), v_who, v.id, o.id, 'shipreq_noemail:' || v_id)
    on conflict (organization_id, auto_key) where auto_key is not null do nothing;
  end if;
  return v_id;
end $$;
revoke execute on function public.shipment_request_make(uuid, boolean) from public, anon;
grant execute on function public.shipment_request_make(uuid, boolean) to authenticated, service_role;

create or replace function public.orders_shipment_request() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'confirmed' and (tg_op = 'INSERT' or old.status is distinct from 'confirmed') and new.source not in ('order_guide', 'placed_order_summary') then
    perform public.shipment_request_make(new.id, false);
  end if;
  return null;
end $$;
drop trigger if exists orders_shipment_request on public.orders;
create trigger orders_shipment_request after insert or update of status on public.orders for each row execute function public.orders_shipment_request();

-- a vendor's email added later wakes a request that had nobody to go to
create or replace function public.vendor_emails_shipment_request() returns trigger language plpgsql security definer set search_path = public as $$
declare r record; q record;
begin
  for q in select s.id, s.order_id from public.shipment_requests s where s.vendor_id = new.vendor_id and s.status = 'ready' and cardinality(s.to_emails) = 0 loop
    select * into r from public.shipment_request_recipients(q.order_id);
    if cardinality(coalesce(r.to_emails, '{}')) > 0 then
      update public.shipment_requests set to_emails = r.to_emails, cc_emails = coalesce(r.cc_emails, '{}'), reply_to_email_id = r.reply_to, note = null where id = q.id;
      update public.tasks set done_at = now(), closed_how = 'vms', done_note = 'An email was added for the vendor; VMS sends the shipment form.' where auto_key = 'shipreq_noemail:' || q.id and done_at is null;
    end if;
  end loop;
  return null;
end $$;
drop trigger if exists vendor_emails_shipment_request on public.vendor_emails;
create trigger vendor_emails_shipment_request after insert or update of email, roles, contact_type on public.vendor_emails for each row execute function public.vendor_emails_shipment_request();

-- ---- the email -----------------------------------------------------------------------------------------------------
create or replace function public.shipment_request_email(p_req uuid)
returns table (subject text, body text, to_emails text[], cc_emails text[], reply_to_email_id uuid, thread_id uuid, send_as uuid, vendor_id uuid, order_id uuid, attach_routing_letter boolean)
language plpgsql stable security definer set search_path = public as $$
declare s public.shipment_requests%rowtype; o public.orders%rowtype; v public.vendors%rowtype; v_first text; v_po text; v_their text; v_link text; v_hi text; v_subj text; v_body text; v_cap text;
begin
  select * into s from public.shipment_requests where id = p_req;
  if s.id is null then return; end if;
  select * into o from public.orders where id = s.order_id;
  select * into v from public.vendors where id = s.vendor_id;
  v_po := coalesce(nullif(trim(o.po_number), ''), '');
  select nullif(trim(l.doc_number), '') into v_their from public.vendor_links l where l.order_id = o.id and l.kind = 'confirmation' order by l.created_at desc limit 1;
  select split_part(nullif(trim(coalesce(e.from_name, ve.contact_name, '')), ''), ' ', 1) into v_first
    from (select 1) x left join public.emails e on e.id = s.reply_to_email_id left join public.vendor_emails ve on ve.vendor_id = s.vendor_id and lower(ve.email) = s.to_emails[1] and ve.former_at is null limit 1;
  v_hi := 'Hi ' || coalesce(nullif(v_first, ''), 'there') || E',\n\n';
  v_link := 'https://vms.shaverlakesports.com/ship/' || s.token;
  v_cap := case when o.freight_cap_pct is not null then trim(trailing '.' from trim(trailing '0' from o.freight_cap_pct::text)) || '%' else 'the agreed percentage' end;
  if s.kind = 'details' then
    v_subj := 'Shipment details and freight quote for our PO ' || v_po || coalesce(' (your order ' || v_their || ')', '');
    v_body := v_hi || 'Thank you for the confirmation. Due to the tremendous increase in shipping rates, we now require each of our vendors to provide a freight quote prior to shipping any packages, unless you are paying the full freight cost, including backorders.' || E'\n\n'
      || 'If you are paying full freight costs including backorders, we do not need the form filled out. Simply hit reply and confirm that this order and any backorders that may arrive will be shipped free to us.' || E'\n\n'
      || 'Otherwise, please click the link below to enter the shipment details and your current quote. It takes about two minutes.' || E'\n\n' || v_link || E'\n\n'
      || 'Please hold the shipment until we OK the freight.' || E'\n\nThanks,';
  elsif s.kind = 'free_check' then
    v_subj := 'Freight on our PO ' || v_po || coalesce(' (your order ' || v_their || ')', '');
    v_body := v_hi || 'Thank you for the confirmation. Our order was placed with the understanding we would receive free shipping, but we didn''t see that noted on the confirmation. Could you reply and confirm that this order, and any backorders that may arrive, will ship free to us?' || E'\n\nThanks,';
  elsif s.kind = 'half_check' then
    v_subj := 'Freight on our PO ' || v_po || coalesce(' (your order ' || v_their || ')', '');
    v_body := v_hi || 'Thank you for the confirmation. Our order was placed with the understanding that you would cover half of the freight, but we didn''t see that noted on the confirmation. Could you reply and confirm that this order, and any backorders that may arrive, will ship with half the freight covered by you?' || E'\n\n'
      || 'Please also click the link below to enter the shipment details and your freight quote, so we can see our share before it ships. Please hold the shipment until we have confirmed the freight.' || E'\n\n' || v_link || E'\n\nThanks,';
  else
    v_subj := 'Freight on our PO ' || v_po || coalesce(' (your order ' || v_their || ')', '');
    v_body := v_hi || 'Thank you for the confirmation. Our order was placed with the understanding that freight would be capped at ' || v_cap || ' of the order, but we didn''t see that noted on the confirmation. Could you reply and confirm that freight on this order, and on any backorders that may arrive, will not exceed ' || v_cap || '?' || E'\n\n'
      || 'Please also click the link below to enter the shipment details and your freight quote. Please hold the shipment until we have confirmed the freight.' || E'\n\n' || v_link || E'\n\nThanks,';
  end if;
  return query select v_subj, v_body, s.to_emails, s.cc_emails, s.reply_to_email_id, (select e.thread_id from public.emails e where e.id = s.reply_to_email_id), s.send_as, s.vendor_id, s.order_id,
                      exists (select 1 from public.routing_letters where organization_id = s.organization_id);
end $$;
revoke execute on function public.shipment_request_email(uuid) from public, anon;
grant execute on function public.shipment_request_email(uuid) to authenticated, service_role;

create or replace function public.shipment_request_sent(p_req uuid, p_email uuid) returns void language plpgsql security definer set search_path = public as $$
declare s public.shipment_requests%rowtype; v_thread uuid;
begin
  select * into s from public.shipment_requests where id = p_req;
  if s.id is null then return; end if;
  select e.thread_id into v_thread from public.emails e where e.id = p_email;
  update public.shipment_requests set status = 'sent', sent_email_id = p_email, thread_id = v_thread, sent_at = now(), hold = false,
         followup_due_at = public.add_business_days(now(), 3), last_reply_read_at = now() where id = p_req;
  perform public.order_ship_email_sent(s.order_id, p_email);
  update public.emails set order_id = coalesce(order_id, s.order_id) where id = p_email;
end $$;
revoke execute on function public.shipment_request_sent(uuid, uuid) from public, anon, authenticated;
grant execute on function public.shipment_request_sent(uuid, uuid) to service_role;

-- ---- the form --------------------------------------------------------------------------------------------------------
create or replace function public.shipment_form_get(p_token uuid) returns jsonb language plpgsql security definer set search_path = public as $$
declare s public.shipment_requests%rowtype; o public.orders%rowtype; v public.vendors%rowtype; v_last text;
begin
  select * into s from public.shipment_requests where token = p_token;
  if s.id is null then return null; end if;
  select * into o from public.orders where id = s.order_id;
  select * into v from public.vendors where id = s.vendor_id;
  update public.shipment_requests set opened_at = coalesce(opened_at, now()), status = case when status = 'sent' then 'opened' else status end where id = s.id;
  select method into v_last from public.shipment_requests where vendor_id = s.vendor_id and method is not null and id <> s.id order by answered_at desc nulls last limit 1;
  return jsonb_build_object('vendor', v.name, 'po', o.po_number, 'description', o.description, 'kind', s.kind, 'method', coalesce(s.method, v_last),
                            'answered_at', s.answered_at, 'answers', case when s.answered_how = 'form' then s.answers else '{}'::jsonb end, 'status', s.status);
end $$;
revoke execute on function public.shipment_form_get(uuid) from public, anon, authenticated;
grant execute on function public.shipment_form_get(uuid) to service_role;

/** The answers become a freight quote for Trevor, like a quote emailed in (Freight › Freight quotes). */
create or replace function public.shipment_request_quote(p_req uuid) returns uuid language plpgsql security definer set search_path = public as $$
declare s public.shipment_requests%rowtype; o public.orders%rowtype; v_name text; v_who uuid; v_due date; v_task uuid; v_q uuid; a jsonb; items jsonb; v_cost numeric; v_total numeric; v_method text;
begin
  select * into s from public.shipment_requests where id = p_req;
  if s.id is null then return null; end if;
  if s.quote_id is not null then return s.quote_id; end if;
  select * into o from public.orders where id = s.order_id;
  select name into v_name from public.vendors where id = s.vendor_id;
  a := s.answers; items := coalesce(a->'items', '[]'::jsonb);
  v_cost := case when coalesce(a->>'quote_amount', '') ~ '^[0-9]+(\.[0-9]+)?$' then (a->>'quote_amount')::numeric end;
  select sum(case when coalesce(i->>'weight', '') ~ '^[0-9]+(\.[0-9]+)?$' then (i->>'weight')::numeric * greatest(coalesce((i->>'count')::int, 1), 1) else 0 end) into v_total from jsonb_array_elements(items) i;
  v_method := coalesce(s.method, 'parcel');
  insert into public.freight_quotes (organization_id, vendor_id, order_id, email_id, thread_id, status, match_how, vendor_carrier, vendor_service, vendor_cost, transit, details, ships_by, shipment_request_id)
  values (s.organization_id, s.vendor_id, s.order_id, s.reply_email_id, s.thread_id, 'waiting', 'po', nullif(a->>'carrier', ''), null, v_cost, null,
          jsonb_build_object(
            'ship_from', concat_ws(', ', nullif(a->>'company', ''), nullif(a->>'address', ''), concat_ws(' ', nullif(a->>'city', ''), nullif(a->>'state', ''))),
            'ship_from_zip', a->>'zip',
            'pickup_type', concat_ws(', ', case when (a->'services') ? 'residential' then 'residential' else 'business' end, case when (a->'services') ? 'liftgate' then 'lift gate needed' end, case when (a->'services') ? 'limited_access' then 'limited access' end),
            'ready_date', a->>'ready_date', 'pickup_hours', a->>'hours',
            'contact', concat_ws(' · ', nullif(a->>'contact_name', ''), nullif(a->>'contact_email', ''), nullif(a->>'contact_phone', '')),
            'cartons', case when v_method = 'parcel' then items else '[]'::jsonb end,
            'pallets', case when v_method = 'pallet' then items else '[]'::jsonb end,
            'total_weight', v_total, 'value', null,
            'hazardous', exists (select 1 from jsonb_array_elements(items) i where (i->>'hazmat')::boolean),
            'notes', coalesce(a->>'notes', ''), 'from_form', true),
          v_method, s.id)
  returning id into v_q;
  v_who := coalesce(public.freight_assignee(s.organization_id), s.send_as);
  v_due := public.next_business_day(now());
  insert into public.tasks (organization_id, title, notes, due_date, remind_at, assigned_to, vendor_id, order_id, thread_id, auto_key)
  values (s.organization_id,
          left('Get freight quote: ' || coalesce(v_name, 'vendor') || coalesce(', PO ' || nullif(trim(o.po_number), ''), '') || case when v_method = 'pallet' then ' – Pallet, P1' else ' – Parcel, WWEX/UPS' end, 200),
          'The vendor filled in the shipment form. Get ' || case when v_method = 'pallet' then 'a Priority One' else 'a WWEX/UPS' end || ' price, then approve the cheapest on the freight quote (Freight › Freight quotes).',
          v_due, now(), v_who, s.vendor_id, s.order_id, s.thread_id, 'freight_quote:' || v_q)
  on conflict (organization_id, auto_key) where auto_key is not null do nothing
  returning id into v_task;
  update public.freight_quotes set task_id = v_task where id = v_q;
  update public.shipment_requests set quote_id = v_q where id = s.id;
  return v_q;
end $$;
revoke execute on function public.shipment_request_quote(uuid) from public, anon, authenticated;
grant execute on function public.shipment_request_quote(uuid) to service_role;

/** The request is answered: reminders and the follow-up go away; a shipping contact we learn is kept for next time. */
create or replace function public.shipment_request_answered(p_req uuid, p_how text, p_email uuid, p_method text, p_answers jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare s public.shipment_requests%rowtype; v_email text;
begin
  select * into s from public.shipment_requests where id = p_req;
  if s.id is null then return null; end if;
  update public.shipment_requests set status = 'answered', answered_at = coalesce(answered_at, now()), answered_how = p_how, reply_email_id = coalesce(p_email, reply_email_id),
         method = coalesce(p_method, method), answers = coalesce(p_answers, '{}'::jsonb), followup_due_at = null where id = p_req;
  update public.tasks set done_at = now(), closed_how = 'vms', done_note = 'The vendor sent the shipment details' || case when p_how = 'form' then ' on the form' else ' by email' end || ' (VMS saw it).' where id = s.followup_task_id and done_at is null;
  delete from public.email_drafts where id = s.followup_draft_id and gmail_draft_id is null;
  v_email := lower(nullif(trim(p_answers->>'contact_email'), ''));
  if v_email is not null and v_email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' and not exists (select 1 from public.vendor_emails where vendor_id = s.vendor_id and lower(email) = v_email) then
    insert into public.vendor_emails (organization_id, vendor_id, email, contact_name, phone, contact_type, roles, source)
    values (s.organization_id, s.vendor_id, v_email, nullif(trim(p_answers->>'contact_name'), ''), nullif(trim(p_answers->>'contact_phone'), ''), 'shipping', array['shipping']::public.contact_type[], 'vendor_form');
  end if;
  return public.shipment_request_quote(p_req);
end $$;
revoke execute on function public.shipment_request_answered(uuid, text, uuid, text, jsonb) from public, anon, authenticated;
grant execute on function public.shipment_request_answered(uuid, text, uuid, text, jsonb) to service_role;

create or replace function public.shipment_form_submit(p_token uuid, p_method text, p_answers jsonb) returns jsonb language plpgsql security definer set search_path = public as $$
declare s public.shipment_requests%rowtype; v_q uuid; v_name text;
begin
  select * into s from public.shipment_requests where token = p_token;
  if s.id is null or s.status in ('cancelled', 'skipped') then return null; end if;
  if p_method not in ('pallet', 'parcel') then raise exception 'Pick pallet or parcel'; end if;
  v_q := public.shipment_request_answered(s.id, 'form', null, p_method, p_answers);
  select name into v_name from public.vendors where id = s.vendor_id;
  return jsonb_build_object('vendor', v_name, 'quote_id', v_q);
end $$;
revoke execute on function public.shipment_form_submit(uuid, text, jsonb) from public, anon, authenticated;
grant execute on function public.shipment_form_submit(uuid, text, jsonb) to service_role;

-- ---- the vendor's reply by email (Claude's reading) ----------------------------------------------------------------
-- p_reading: {"answer": "free" | "terms_ok" | "charged" | "details" | "other", "method": "pallet"|"parcel"|null, "answers": {...}, "note": "…"}
create or replace function public.shipment_request_reply(p_req uuid, p_email uuid, p_reading jsonb) returns text
language plpgsql security definer set search_path = public as $$
declare s public.shipment_requests%rowtype; o public.orders%rowtype; v_name text; v_ans text; v_buyer uuid; v_po text; v_terms text; v_task uuid; e public.emails%rowtype;
begin
  select * into s from public.shipment_requests where id = p_req;
  if s.id is null then return null; end if;
  select * into o from public.orders where id = s.order_id;
  select * into e from public.emails where id = p_email;
  select name into v_name from public.vendors where id = s.vendor_id;
  v_po := coalesce(nullif(trim(o.po_number), ''), '');
  v_terms := public.order_freight_terms(o);
  v_ans := p_reading->>'answer';
  update public.shipment_requests set last_reply_read_at = greatest(coalesce(last_reply_read_at, e.received_at), e.received_at) where id = s.id;
  if v_ans in ('free', 'terms_ok') then
    update public.orders set freight_terms = case when v_ans = 'free' then 'free' else coalesce(freight_terms, v_terms) end, free_shipping = case when v_ans = 'free' then true else free_shipping end,
           freight_terms_confirmed_at = now(), freight_terms_confirmed_how = 'reply', freight_terms_email_id = p_email where id = o.id;
    update public.shipment_requests set status = 'confirmed', reply_email_id = p_email, answered_at = coalesce(answered_at, now()), answered_how = 'email', followup_due_at = null, note = nullif(p_reading->>'note', '') where id = s.id;
    update public.tasks set done_at = now(), closed_how = 'vms', done_note = coalesce(v_name, 'The vendor') || ' confirmed by email on ' || to_char(e.received_at at time zone 'America/Los_Angeles', 'Mon FMDD') || ': ' || case when v_ans = 'free' then 'free freight, backorders included' else 'the agreed freight terms' end || ' (VMS read the reply).' where id = s.followup_task_id and done_at is null;
    delete from public.email_drafts where id = s.followup_draft_id and gmail_draft_id is null;
    return 'confirmed';
  elsif v_ans = 'charged' and v_terms in ('free', 'half', 'capped') then
    -- a change to what was agreed: whoever placed the order decides, Trevor cc'd
    v_buyer := coalesce(o.placed_by_id, (select owner_id from public.email_threads where id = s.thread_id), public.org_admin(o.organization_id));
    update public.shipment_requests set status = 'disputed', reply_email_id = p_email, followup_due_at = null, note = nullif(p_reading->>'note', '') where id = s.id;
    update public.tasks set done_at = now(), closed_how = 'vms', done_note = 'The vendor replied that freight will be charged; the order''s buyer has it.' where id = s.followup_task_id and done_at is null;
    delete from public.email_drafts where id = s.followup_draft_id and gmail_draft_id is null;
    insert into public.tasks (organization_id, title, notes, due_date, remind_at, assigned_to, created_by, vendor_id, order_id, thread_id, auto_key)
    values (o.organization_id, left(coalesce(v_name, 'The vendor') || ' says freight will be charged on PO ' || v_po || ' (we agreed ' || case v_terms when 'free' then 'free freight' when 'half' then 'half freight' else 'a cap of ' || coalesce(o.freight_cap_pct::text, '?') || '%' end || ')', 200),
            'Their reply is on the conversation (Go to it). Decide: hold them to what was agreed, accept the freight, or cancel. If we take the freight, reply to the vendor; the shipment form link is in VMS''s first email on this conversation. Trevor is copied on this.',
            public.next_business_day(now()), now(), v_buyer, s.send_as, s.vendor_id, o.id, s.thread_id, 'shipdispute:' || s.id)
    on conflict (organization_id, auto_key) where auto_key is not null do nothing returning id into v_task;
    update public.shipment_requests set dispute_task_id = v_task where id = s.id;
    if s.send_as is not null and s.send_as <> v_buyer then
      insert into public.tasks (organization_id, title, notes, due_date, remind_at, assigned_to, created_by, vendor_id, order_id, thread_id, auto_key)
      values (o.organization_id, left('FYI: ' || coalesce(v_name, 'the vendor') || ' says freight will be charged on PO ' || v_po, 200),
              'For your information: the buyer has the decision. Mark this done once you have seen it; it also closes when the buyer finishes theirs.',
              public.next_business_day(now()), now(), s.send_as, s.send_as, s.vendor_id, o.id, s.thread_id, 'shipdispute_cc:' || s.id)
      on conflict (organization_id, auto_key) where auto_key is not null do nothing;
    end if;
    if s.thread_id is not null then update public.email_threads set owner_id = v_buyer, owner_set_at = now() where id = s.thread_id; end if;
    return 'disputed';
  elsif v_ans = 'details' then
    perform public.shipment_request_answered(s.id, 'email', p_email, nullif(p_reading->>'method', ''), coalesce(p_reading->'answers', '{}'::jsonb));
    return 'answered';
  end if;
  return 'other';
end $$;
revoke execute on function public.shipment_request_reply(uuid, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.shipment_request_reply(uuid, uuid, jsonb) to service_role;

-- the buyer's decision closes Trevor's FYI
create or replace function public.tasks_shipdispute_done() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.done_at is not null and old.done_at is null and new.auto_key like 'shipdispute:%' then
    update public.tasks set done_at = now(), closed_how = 'vms', done_note = 'The buyer finished their decision on this.' where auto_key = 'shipdispute_cc:' || substr(new.auto_key, 13) and done_at is null;
  end if;
  return null;
end $$;
drop trigger if exists tasks_shipdispute_done on public.tasks;
create trigger tasks_shipdispute_done after update of done_at on public.tasks for each row execute function public.tasks_shipdispute_done();

-- ---- 3 business days with nothing back: Trevor's task and the follow-up draft ------------------------------------
create or replace function public.shipment_request_followups(p_org uuid) returns integer language plpgsql security definer set search_path = public as $$
declare s record; o public.orders%rowtype; v_name text; v_first text; v_task uuid; v_draft uuid; v_last uuid; v_po text; v_subj text; n integer := 0; m public.emails%rowtype;
begin
  for s in select * from public.shipment_requests where organization_id = p_org and status in ('sent', 'opened') and followup_due_at <= now() and followup_task_id is null loop
    select * into o from public.orders where id = s.order_id;
    select name into v_name from public.vendors where id = s.vendor_id;
    select * into m from public.emails where id = s.sent_email_id;
    v_po := coalesce(nullif(trim(o.po_number), ''), '');
    select split_part(full_name, ' ', 1) into v_first from public.profiles where id = s.send_as;
    select id into v_last from public.emails where thread_id = s.thread_id and direction <> 'internal' order by received_at desc limit 1;
    v_subj := case when m.subject ilike 'Re:%' then m.subject else 'Re: ' || coalesce(m.subject, 'Shipment details for PO ' || v_po) end;
    insert into public.email_drafts (organization_id, owner_id, created_by, to_emails, cc_emails, subject, body, thread_id, reply_to_email_id, vendor_id, order_id, note)
    values (s.organization_id, s.send_as, s.send_as, s.to_emails, s.cc_emails, v_subj,
            'Hi,' || E'\n\n' || 'Following up on PO ' || v_po || '. We haven''t received the shipment details yet. Could you fill in the short form here when you have a minute: https://vms.shaverlakesports.com/ship/' || s.token
              || E'. It takes about two minutes and helps us get the freight booked and the receiving ready on our end.\n\nThanks,',
            s.thread_id, coalesce(v_last, s.sent_email_id), s.vendor_id, s.order_id,
            'Follow-up on the shipment details from ' || coalesce(v_name, 'the vendor') || ' (VMS made this draft after 3 business days with no answer; send it or change it)')
    returning id into v_draft;
    insert into public.tasks (organization_id, title, notes, due_date, remind_at, assigned_to, created_by, vendor_id, order_id, thread_id, draft_id, auto_key)
    values (s.organization_id, left('No shipment details yet: ' || coalesce(v_name, 'the vendor') || ', PO ' || v_po, 200),
            'VMS emailed them on ' || to_char(s.sent_at at time zone 'America/Los_Angeles', 'Mon FMDD') || ' and nothing has come back after 3 business days. A follow-up email is ready in your Drafts (Go to it): send it as is or change it. This task finishes itself when the form or a reply with the details comes in.',
            current_date, now(), s.send_as, s.send_as, s.vendor_id, s.order_id, s.thread_id, v_draft, 'shipreq:' || s.id)
    on conflict (organization_id, auto_key) where auto_key is not null do nothing returning id into v_task;
    update public.shipment_requests set followup_task_id = v_task, followup_draft_id = v_draft where id = s.id;
    n := n + 1;
  end loop;
  return n;
end $$;
revoke execute on function public.shipment_request_followups(uuid) from public, anon, authenticated;
grant execute on function public.shipment_request_followups(uuid) to service_role;

-- a person sends the follow-up draft: the request remembers it (gmail-send's mail_command_sent path stamps drafts of tasks)
create or replace function public.shipment_request_followup_sent(p_draft uuid, p_email uuid) returns void language sql security definer set search_path = public as $$
  update public.shipment_requests set followup_draft_id = null, note = coalesce(note, '') where followup_draft_id = p_draft;
  update public.tasks set draft_id = null where draft_id = p_draft and auto_key like 'shipreq:%';
$$;
revoke execute on function public.shipment_request_followup_sent(uuid, uuid) from public, anon, authenticated;
grant execute on function public.shipment_request_followup_sent(uuid, uuid) to service_role;

-- cancelled or received orders drop their request
create or replace function public.orders_shipment_request_end() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.status in ('cancelled', 'received', 'entered', 'ready_to_pay', 'paid') and old.status is distinct from new.status then
    update public.shipment_requests set status = 'cancelled', followup_due_at = null where order_id = new.id and status in ('ready', 'sent', 'opened');
    update public.tasks set done_at = now(), closed_how = 'vms', done_note = 'The order is ' || new.status || '; no shipment details needed now.' where order_id = new.id and done_at is null and (auto_key like 'shipreq:%' or auto_key like 'shipreq_noemail:%');
  end if;
  return null;
end $$;
drop trigger if exists orders_shipment_request_end on public.orders;
create trigger orders_shipment_request_end after update of status on public.orders for each row execute function public.orders_shipment_request_end();

-- ---- lists for the screens --------------------------------------------------------------------------------------
create or replace function public.shipment_requests_waiting(p_org uuid) returns integer language sql stable security definer set search_path = public as $$
  select count(*)::int from public.shipment_requests where organization_id = p_org and status in ('ready', 'sent', 'opened') and public.user_in_org(p_org)
$$;
grant execute on function public.shipment_requests_waiting(uuid) to authenticated;

-- ---- the scheduler: every 5 minutes --------------------------------------------------------------------------------
do $$ begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') and exists (select 1 from pg_extension where extname = 'pg_net') then
    perform cron.unschedule(jobid) from cron.job where jobname = 'shipment-requests';
    perform cron.schedule('shipment-requests', '*/5 * * * *',
      $job$select net.http_post(url := 'https://bpdpkytfmpbwpbmpejbf.supabase.co/functions/v1/shipment-requests', headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'mail_cron_secret')), body := '{"action":"cron"}'::jsonb, timeout_milliseconds := 120000)$job$);
  end if;
end $$;

-- ---- orders already confirmed: a request on hold, not sent until Dana says ----------------------------------------
do $$ declare o record; begin
  for o in select id from public.orders where status = 'confirmed' loop
    perform public.shipment_request_make(o.id, true);
  end loop;
end $$;

-- ---- sending a follow-up draft does not finish the task that waits on the vendor ------------------------------------
-- (the shipment follow-up and the credit follow-up, Oct 27): the task stays until the answer comes; the draft is just gone.
create or replace function public.mail_command_sent(p_draft uuid, p_email uuid, p_by uuid) returns void
language plpgsql security definer set search_path = public as $$
declare t public.tasks%rowtype; e public.emails%rowtype; a public.po_asks%rowtype;
begin
  select * into e from public.emails where id = p_email;
  -- a PO ask (0235): stamped asked
  update public.po_asks set status = 'asked', asked_at = coalesce(e.received_at, now()), ask_email_id = p_email,
         thread_id = e.thread_id, read_until = coalesce(e.received_at, now()), draft_id = null
   where draft_id = p_draft and status = 'drafted' returning * into a;
  if a.id is not null then
    perform public.po_ask_log(a, 'po_asked', jsonb_build_object('email_id', p_email, 'thread_id', e.thread_id, 'by', p_by,
      'note', case a.kind when 'add' then format('Asked them to add our PO %s', a.our_po) else format('Asked them to use our PO %s instead of %s and send an updated confirmation', a.our_po, a.their_po) end));
  end if;
  select * into t from public.tasks where draft_id = p_draft limit 1;
  if not found then return; end if;
  -- a follow-up that waits on the vendor (shipment details Oct 30, credits Oct 27): the task stays, the draft is just gone
  if t.auto_key like 'shipreq:%' or t.auto_key like 'credit_req:%' then
    update public.tasks set draft_id = null, thread_id = coalesce(e.thread_id, thread_id),
           notes = coalesce(notes, '') || E'\n\nFollow-up sent on ' || to_char(coalesce(e.received_at, now()) at time zone 'America/Los_Angeles', 'Mon FMDD') || '.'
     where id = t.id;
    if t.auto_key like 'shipreq:%' then perform public.shipment_request_followup_sent(p_draft, p_email); end if;
    return;
  end if;
  update public.tasks set done_at = coalesce(done_at, now()), done_by = coalesce(done_by, p_by), done_note = coalesce(done_note, 'Email sent'),
         thread_id = coalesce(e.thread_id, thread_id), draft_id = null
   where id = t.id;
  if t.auto_key like 'vmscmd:%' and e.thread_id is not null then
    update public.mail_commands set watch_thread_ids = array(select distinct x from unnest(watch_thread_ids || e.thread_id) x), watched_at = coalesce(watched_at, now())
     where id = split_part(t.auto_key, ':', 2)::uuid;
  end if;
end;
$$;
