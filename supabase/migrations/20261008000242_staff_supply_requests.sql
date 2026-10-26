-- 0242 — Supply requests from the staff's work email (Dana, Oct 26): "You missed some. She made requests in October."
-- Annette's Oct 5 and Oct 21 requests came from annette@shaverlakesports.com. Mail between two of our own addresses is
-- filed as 'internal', and the supply reader only read 'in' mail, so none of it was ever read.
--
--   • supply_request_queue reads staff mail to orders@ from our own addresses too (Annette, Cat, Trevor, Jarrett…).
--     Never read: orders@ itself, the admin's own addresses (her forwards are not requests), and anyone marked
--     email_senders.skip_supply_requests (Jane: "hasn't been with us since Mother's Day").
--   • A request found late (the back-check, or mail read after its confirmation came in) has the order emails since it
--     was asked for read again, so a confirmation that already came in still fills it.
--   • The person who asked is emailed only for a confirmation that came in the last 3 days, never for an old one.
--   • A late request's task reminds no sooner than 30 minutes out, so its confirmation can be read first.
--   • Back-check: the supplies function now reads the last 13 months of staff mail (the queue does it on its own).

set local lock_timeout = '5s';

alter table public.email_senders add column if not exists skip_supply_requests boolean not null default false;
comment on column public.email_senders.skip_supply_requests is 'Mail from this address is never read as a staff supply request: former staff, the admin''s own addresses (Dana, Oct 26).';

-- Jane left in May 2026; Dana's own addresses forward things, they don't ask for supplies.
insert into public.email_senders (organization_id, sender_key, kind, display_name, skip_supply_requests)
select o.id, 'jane@shaverlakesports.com', 'internal', 'Jane Grace (no longer with us)', true from public.organizations o
on conflict (organization_id, sender_key) do update set skip_supply_requests = true;
update public.email_senders set skip_supply_requests = true where sender_key in ('billing.slsports@gmail.com', 'danapowell2024@gmail.com');

-- Staff emails for Claude to read, newest first: from outside addresses marked Ours or a login's email (as before), and
-- now mail from our own addresses ('internal'), except orders@, the admin and anyone skipped.
create or replace function public.supply_request_queue(p_org uuid, p_limit integer default 10)
returns table (email_id uuid, subject text, body_text text, sent_at timestamptz, from_name text, from_email text, thread_has_request boolean)
language sql stable security definer set search_path = public as $$
  select e.id, e.subject, left(e.body_text, 2000), e.received_at, e.from_name, e.from_email,
         exists (select 1 from public.supply_requests r where r.thread_id = e.thread_id)
    from public.emails e
    left join public.email_senders s on s.id = e.sender_id
   where e.organization_id = p_org and e.supply_read_at is null and e.mailbox_id is null
     and e.received_at > now() - interval '13 months'
     and ((e.direction = 'in' and (s.kind = 'internal' or exists (select 1 from public.profiles p where p.organization_id = p_org and lower(p.email) = lower(e.from_email))))
          or e.direction = 'internal')
     and not exists (select 1 from public.mail_accounts a where a.organization_id = p_org and lower(a.mailbox) = lower(e.from_email))
     and not exists (select 1 from public.profiles p where p.id = public.org_admin(p_org) and lower(p.email) = lower(e.from_email))
     and not exists (select 1 from public.email_senders x where x.organization_id = p_org and x.sender_key = lower(e.from_email) and x.skip_supply_requests)
   order by e.received_at desc
   limit p_limit
$$;

-- Claude's reading of a staff email (as 0080), and: a request found after order emails were already read has the order
-- emails since it was asked for read again.
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
  if v_id is not null then
    update public.emails x set supply_conf_read_at = null
     where x.organization_id = e.organization_id and x.supply_conf_read_at is not null and x.direction = 'in'
       and x.received_at >= e.received_at - interval '1 day'
       and coalesce(x.subject, '') ~* '(order|confirm|ship|deliver|arriv|receipt|purchase|track|package|dispatch)';
    perform public.supply_make_task(v_id);
  end if;
  return v_id;
end;
$$;

-- The task (as 0080); a request found late reminds no sooner than 30 minutes out.
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
          v_due, greatest((v_due + time '09:00') at time zone 'America/Los_Angeles', now() + interval '30 minutes'), v_who, r.thread_id, 'Supplies', 'supply:' || r.id)
  on conflict (organization_id, auto_key) where auto_key is not null do nothing
  returning id into v_task;
  update public.supply_requests set task_id = v_task where id = p_request;
  return v_task;
end;
$$;

-- Order emails against open requests (as 0080); the person who asked is told only for a confirmation from the last 3 days.
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
             confirm_email_id = e.id, confirm_private = v_priv,
             notify_pending = not r.is_old and r.requested_by_email is not null and e.received_at > now() - interval '3 days'
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

revoke execute on function public.supply_make_task(uuid), public.supply_request_queue(uuid, integer), public.supply_from_email(uuid, boolean, text, jsonb, text, text, boolean),
  public.supply_from_confirmation(uuid, text, uuid[], text, text, date, numeric, text) from public, anon, authenticated;
grant execute on function public.supply_make_task(uuid), public.supply_request_queue(uuid, integer), public.supply_from_email(uuid, boolean, text, jsonb, text, text, boolean),
  public.supply_from_confirmation(uuid, text, uuid[], text, text, date, numeric, text) to service_role;
