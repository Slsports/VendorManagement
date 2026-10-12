-- 0101 — Supplies (Dana, Oct 12): "Most of the emails from Annette Reinhart are going to be internal supply order requests
-- from the staff to me. I'd like an area where all the supplies requisitions live. It should be a task before I order it
-- and once I have ordered them it says where I ordered from (based on confirmation emails coming in) and when it is
-- supposed to arrive." Task due 2 days after the request; when the confirmation arrives the person who asked gets an
-- email automatically (new requests only; old ones are loaded and matched without emails).
-- The supplies function (every minute): Claude reads staff emails into requests, and order confirmations, shipping and
-- delivery emails (orders@ and the admin's own inboxes) onto them, then emails the requester.
-- A request whose confirmation came from a private inbox shows only to the admin (private mail stays private).

create table if not exists public.supply_requests (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations(id) on delete cascade,
  summary          text not null check (length(trim(summary)) > 0),
  items            jsonb not null default '[]',              -- [{name, qty}]
  store_code       text,
  requested_by_name  text,
  requested_by_email text,
  requested_at     timestamptz not null default now(),
  email_id         uuid references public.emails(id) on delete set null,
  thread_id        uuid references public.email_threads(id) on delete set null,
  task_id          uuid references public.tasks(id) on delete set null,
  status           text not null default 'requested' check (status in ('requested', 'ordered', 'arrived', 'closed')),
  is_old           boolean not null default false,             -- loaded from before Supplies existed: no task, no email
  ordered_from     text,
  order_number     text,
  ordered_at       timestamptz,
  order_total      numeric(12,2),
  expected_at      date,
  tracking         text,
  arrived_at       timestamptz,
  confirm_email_id uuid references public.emails(id) on delete set null,
  confirm_private  boolean not null default false,
  notify_pending   boolean not null default false,
  notified_at      timestamptz,
  notify_text      text,
  notify_error     text,
  notes            text,
  created_by       uuid references public.profiles(id) on delete set null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
comment on table public.supply_requests is 'Store supply requests from staff (Supplies page): requested → ordered (where, order #, expected arrival, from the confirmation email) → arrived.';
create index if not exists supply_requests_org_idx on public.supply_requests (organization_id, status, requested_at desc);
create unique index if not exists supply_requests_email_key on public.supply_requests (email_id) where email_id is not null;
drop trigger if exists supply_requests_set_updated_at on public.supply_requests;
create trigger supply_requests_set_updated_at before update on public.supply_requests for each row execute function public.set_updated_at();

alter table public.supply_requests enable row level security;
drop policy if exists "supply_requests: members read" on public.supply_requests;
create policy "supply_requests: members read" on public.supply_requests for select to authenticated
  using (public.user_in_org(organization_id) and (not confirm_private or public.is_admin()));
drop policy if exists "supply_requests: editors write" on public.supply_requests;
create policy "supply_requests: editors write" on public.supply_requests for all to authenticated
  using (public.user_can_edit() and public.user_in_org(organization_id) and (not confirm_private or public.is_admin()))
  with check (public.user_can_edit() and public.user_in_org(organization_id));
grant select, insert, update, delete on table public.supply_requests to authenticated;
grant all on table public.supply_requests to service_role;

alter table public.emails add column if not exists supply_read_at timestamptz;
alter table public.emails add column if not exists supply_conf_read_at timestamptz;

-- The task for a new request: the admin orders supplies; due 2 days after it was asked for.
create or replace function public.supply_make_task(p_request uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  r      public.supply_requests%rowtype;
  v_who  uuid;
  v_due  date;
  v_task uuid;
begin
  select * into r from public.supply_requests where id = p_request;
  if not found or r.is_old or r.status <> 'requested' or r.task_id is not null then return r.task_id; end if;
  v_who := public.org_admin(r.organization_id);
  if v_who is null then return null; end if;
  v_due := (r.requested_at at time zone 'America/Los_Angeles')::date + 2;
  insert into public.tasks (organization_id, title, notes, due_date, remind_at, assigned_to, thread_id, tag_other, auto_key)
  values (r.organization_id, left('Order supplies: ' || r.summary, 200),
          concat_ws(E'\n', case when r.requested_by_name is not null then 'Asked for by ' || r.requested_by_name end, 'It closes on its own when the order confirmation email comes in.'),
          v_due, (v_due + time '09:00') at time zone 'America/Los_Angeles', v_who, r.thread_id, 'Supplies', 'supply:' || r.id)
  on conflict (organization_id, auto_key) where auto_key is not null do nothing
  returning id into v_task;
  update public.supply_requests set task_id = v_task where id = p_request;
  return v_task;
end;
$$;

-- Staff emails for Claude to read: from our staff (marked Ours, or a login's email), orders@ only, newest first.
create or replace function public.supply_request_queue(p_org uuid, p_limit integer default 10)
returns table (email_id uuid, subject text, body_text text, sent_at timestamptz, from_name text, from_email text, thread_has_request boolean)
language sql stable security definer set search_path = public as $$
  select e.id, e.subject, left(e.body_text, 2000), e.received_at, e.from_name, e.from_email,
         exists (select 1 from public.supply_requests r where r.thread_id = e.thread_id)
    from public.emails e
    left join public.email_senders s on s.id = e.sender_id
   where e.organization_id = p_org and e.direction = 'in' and e.supply_read_at is null and e.mailbox_id is null
     and e.received_at > now() - interval '13 months'
     and (s.kind = 'internal' or exists (select 1 from public.profiles p where p.organization_id = p_org and lower(p.email) = lower(e.from_email)))
   order by e.received_at desc
   limit p_limit
$$;

-- Claude's reading of a staff email. A supply request becomes a request (and, when new, a task). Returns its id.
create or replace function public.supply_from_email(p_email uuid, p_is_request boolean, p_summary text, p_items jsonb, p_requester text, p_store text, p_old boolean)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  e    public.emails%rowtype;
  v_id uuid;
begin
  select * into e from public.emails where id = p_email;
  if not found then return null; end if;
  update public.emails set supply_read_at = now() where id = p_email;
  if not coalesce(p_is_request, false) or nullif(trim(p_summary), '') is null then return null; end if;
  insert into public.supply_requests (organization_id, summary, items, store_code, requested_by_name, requested_by_email, requested_at, email_id, thread_id, is_old)
  values (e.organization_id, left(trim(p_summary), 300), coalesce(p_items, '[]'::jsonb), nullif(upper(trim(p_store)), ''),
          coalesce(nullif(trim(p_requester), ''), e.from_name), lower(e.from_email), e.received_at, e.id, e.thread_id, p_old)
  on conflict (email_id) where email_id is not null do nothing
  returning id into v_id;
  if v_id is not null then perform public.supply_make_task(v_id); end if;
  return v_id;
end;
$$;

-- Order emails for Claude to check against open requests: orders@ and the admin's own inboxes, order/shipping words,
-- not from vendors, reps or freight companies, since the oldest open request. Service role only.
create or replace function public.supply_confirmation_queue(p_org uuid, p_limit integer default 10)
returns table (email_id uuid, subject text, body_text text, sent_at timestamptz, from_name text, from_email text)
language sql stable security definer set search_path = public as $$
  select e.id, e.subject, left(coalesce(e.body_text, e.snippet), 2500), e.received_at, e.from_name, e.from_email
    from public.emails e
    left join public.email_senders s on s.id = e.sender_id
    left join public.mailboxes m on m.id = e.mailbox_id
   where e.organization_id = p_org and e.direction = 'in' and e.supply_conf_read_at is null and e.copy_of is null
     and (e.mailbox_id is null or m.owner_id = public.org_admin(p_org))
     and coalesce(s.kind, 'unknown') not in ('vendor', 'rep_group', 'carrier', 'internal')
     and coalesce(e.subject, '') ~* '(order|confirm|ship|deliver|arriv|receipt|purchase|track|package|dispatch)'
     and e.received_at >= (select min(r.requested_at) - interval '1 day' from public.supply_requests r
                            where r.organization_id = p_org and r.status in ('requested', 'ordered'))
   order by e.received_at
   limit p_limit
$$;

-- Claude's reading of an order email against the open requests. kind: confirmation / shipped / delivered / none.
create or replace function public.supply_from_confirmation(p_email uuid, p_kind text, p_requests uuid[], p_seller text, p_order text, p_expected date, p_total numeric, p_tracking text)
returns integer language plpgsql security definer set search_path = public as $$
declare
  e       public.emails%rowtype;
  r       public.supply_requests%rowtype;
  v_priv  boolean;
  n       integer := 0;
begin
  select * into e from public.emails where id = p_email;
  if not found then return 0; end if;
  update public.emails set supply_conf_read_at = now() where id = p_email;
  if p_kind not in ('confirmation', 'shipped', 'delivered') or p_requests is null then return 0; end if;
  v_priv := e.mailbox_id is not null and not exists (select 1 from public.email_threads t where t.id = e.thread_id and t.shared_at is not null);
  for r in select * from public.supply_requests where id = any (p_requests) and organization_id = e.organization_id and status in ('requested', 'ordered') loop
    if p_kind = 'confirmation' and r.status = 'requested' then
      update public.supply_requests set status = 'ordered', ordered_from = left(nullif(trim(p_seller), ''), 120), order_number = left(nullif(trim(p_order), ''), 80),
             ordered_at = e.received_at, order_total = p_total, expected_at = p_expected, tracking = coalesce(nullif(trim(p_tracking), ''), tracking),
             confirm_email_id = e.id, confirm_private = v_priv, notify_pending = not r.is_old and r.requested_by_email is not null
       where id = r.id;
      update public.tasks set done_at = now(), done_note = 'Ordered' || coalesce(' from ' || nullif(trim(p_seller), ''), '')
       where id = r.task_id and done_at is null;
      n := n + 1;
    elsif p_kind = 'shipped' then
      update public.supply_requests set status = 'ordered', expected_at = coalesce(p_expected, expected_at), tracking = coalesce(nullif(trim(p_tracking), ''), tracking),
             ordered_from = coalesce(ordered_from, left(nullif(trim(p_seller), ''), 120)), order_number = coalesce(order_number, left(nullif(trim(p_order), ''), 80)),
             ordered_at = coalesce(ordered_at, e.received_at), confirm_email_id = coalesce(confirm_email_id, e.id), confirm_private = confirm_private or v_priv
       where id = r.id;
      update public.tasks set done_at = now(), done_note = 'Ordered' where id = r.task_id and done_at is null;
      n := n + 1;
    elsif p_kind = 'delivered' then
      update public.supply_requests set status = 'arrived', arrived_at = e.received_at,
             ordered_from = coalesce(ordered_from, left(nullif(trim(p_seller), ''), 120)), order_number = coalesce(order_number, left(nullif(trim(p_order), ''), 80)),
             confirm_private = confirm_private or v_priv
       where id = r.id;
      update public.tasks set done_at = now(), done_note = 'Arrived' where id = r.task_id and done_at is null;
      n := n + 1;
    end if;
  end loop;
  return n;
end;
$$;

-- Requests to email about (the confirmation came in) and recording the email. Service role only.
create or replace function public.supply_notify_queue(p_org uuid)
returns table (id uuid, summary text, requested_by_name text, requested_by_email text, ordered_from text, order_number text, expected_at date,
               gmail_thread_id text, message_id_header text, subject text)
language sql stable security definer set search_path = public as $$
  select r.id, r.summary, r.requested_by_name, r.requested_by_email, r.ordered_from, r.order_number, r.expected_at,
         t.gmail_thread_id, e.message_id_header, e.subject
    from public.supply_requests r
    left join public.emails e on e.id = r.email_id
    left join public.email_threads t on t.id = r.thread_id
   where r.organization_id = p_org and r.notify_pending and r.notified_at is null and r.requested_by_email is not null
   limit 10
$$;

create or replace function public.supply_notified(p_request uuid, p_text text, p_error text)
returns void language sql security definer set search_path = public as $$
  update public.supply_requests set notify_pending = false,
         notified_at = case when p_error is null then now() end, notify_text = p_text, notify_error = p_error
   where id = p_request;
$$;

-- People: add a request by hand (New request), and move one along (ordered / arrived / closed / back).
create or replace function public.supply_add(p_org uuid, p_summary text, p_requester text default null, p_store text default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  if not (public.user_can_edit() and public.user_in_org(p_org)) then raise exception 'Only admins, managers and buyers add supply requests'; end if;
  if nullif(trim(p_summary), '') is null then raise exception 'Say what is needed'; end if;
  insert into public.supply_requests (organization_id, summary, requested_by_name, store_code, created_by)
  values (p_org, left(trim(p_summary), 300), nullif(trim(p_requester), ''), nullif(upper(trim(p_store)), ''), auth.uid())
  returning id into v_id;
  perform public.supply_make_task(v_id);
  return v_id;
end;
$$;

create or replace function public.supply_set(p_request uuid, p_status text, p_from text default null, p_order text default null, p_expected date default null)
returns void language plpgsql security definer set search_path = public as $$
declare r public.supply_requests%rowtype;
begin
  if not public.user_can_edit() then raise exception 'Only admins, managers and buyers change supply requests'; end if;
  select * into r from public.supply_requests where id = p_request;
  if not found or not public.user_in_org(r.organization_id) or (r.confirm_private and not public.is_admin()) then raise exception 'Not found'; end if;
  if p_status not in ('requested', 'ordered', 'arrived', 'closed') then raise exception 'Unknown status %', p_status; end if;
  update public.supply_requests set status = p_status,
         ordered_from = case when p_status = 'ordered' then coalesce(nullif(trim(p_from), ''), ordered_from) else ordered_from end,
         order_number = case when p_status = 'ordered' then coalesce(nullif(trim(p_order), ''), order_number) else order_number end,
         expected_at  = case when p_status = 'ordered' then coalesce(p_expected, expected_at) else expected_at end,
         ordered_at   = case when p_status = 'ordered' then coalesce(ordered_at, now()) when p_status = 'requested' then null else ordered_at end,
         arrived_at   = case when p_status = 'arrived' then coalesce(arrived_at, now()) when p_status in ('requested', 'ordered') then null else arrived_at end
   where id = p_request;
  if p_status <> 'requested' then
    update public.tasks set done_at = now(), done_note = case p_status when 'closed' then 'Closed' when 'arrived' then 'Arrived' else 'Ordered' end
     where id = r.task_id and done_at is null;
  end if;
end;
$$;

revoke execute on function public.supply_make_task(uuid), public.supply_request_queue(uuid, integer), public.supply_from_email(uuid, boolean, text, jsonb, text, text, boolean),
  public.supply_confirmation_queue(uuid, integer), public.supply_from_confirmation(uuid, text, uuid[], text, text, date, numeric, text),
  public.supply_notify_queue(uuid), public.supply_notified(uuid, text, text) from public, anon, authenticated;
grant execute on function public.supply_make_task(uuid), public.supply_request_queue(uuid, integer), public.supply_from_email(uuid, boolean, text, jsonb, text, text, boolean),
  public.supply_confirmation_queue(uuid, integer), public.supply_from_confirmation(uuid, text, uuid[], text, text, date, numeric, text),
  public.supply_notify_queue(uuid), public.supply_notified(uuid, text, text) to service_role;
revoke execute on function public.supply_add(uuid, text, text, text), public.supply_set(uuid, text, text, text, date) from public, anon;
grant execute on function public.supply_add(uuid, text, text, text), public.supply_set(uuid, text, text, text, date) to authenticated, service_role;

-- Annette Reinhart writes from her own Yahoo address: she is our staff (Ours), not "Who is this?".
update public.email_senders set kind = 'internal', decided_at = now() where sender_key = 'annette.reinhart1@yahoo.com' and kind in ('unknown', 'not_vendor');
update public.review_items r set status = 'accepted', resolved_at = now(), resolution_note = 'Ours (staff)'
  from public.email_senders s where s.sender_key = 'annette.reinhart1@yahoo.com' and r.id = s.review_item_id and r.status = 'pending';
