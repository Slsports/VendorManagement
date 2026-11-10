-- The holding tank and the history reader (Dana, Nov 10, "go, build the tank and the history reader").
-- Dana: "put anything you have for me to do or look at that is more than 12 months old into a holding tank until we get
-- more of the bugs worked out". And: read the orders@ mail all the way back, gradually, so old invoices, confirmations and
-- orders reach their vendors instead of flagging her. And: anything in Jarrett's mailbox about an order he placed, is
-- placing or will place is shared to Orders and tied to the vendor.
--
-- Parked: tasks, review cards, conversations waiting on us, accounting papers needing a look and order paperwork checks
-- whose source is older than 12 months get parked_at. Lists and counts leave them out; each list has a Parked tab; a
-- person unparks one, or Dana unparks a whole kind. New items park themselves at birth when their source is old.
-- History: organizations.read_mail_since is the oldest mail the readers look at (today: 12 months back). A daily job moves
-- it back one month while the day's Claude spend is under the cap, until it reaches the first email on file.

-- ---- parked ----------------------------------------------------------------------------------------------------
alter table public.tasks add column if not exists parked_at timestamptz;
alter table public.review_items add column if not exists parked_at timestamptz;
alter table public.email_threads add column if not exists parked_at timestamptz;
alter table public.accounting_documents add column if not exists parked_at timestamptz;
alter table public.order_checks add column if not exists parked_at timestamptz;
create index if not exists tasks_parked on public.tasks (organization_id) where parked_at is not null;
create index if not exists review_items_parked on public.review_items (organization_id) where parked_at is not null;
create index if not exists email_threads_parked on public.email_threads (organization_id) where parked_at is not null;
create index if not exists accounting_documents_parked on public.accounting_documents (organization_id) where parked_at is not null;
create index if not exists order_checks_parked on public.order_checks (organization_id) where parked_at is not null;

create or replace function public.park_cutoff() returns timestamptz language sql stable as $$ select now() - interval '12 months' $$;

-- a task parks when the conversation or order it is about is older than the cutoff
create or replace function public.tasks_park_old() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_at timestamptz;
begin
  if new.parked_at is not null then return new; end if;
  if new.thread_id is not null then select max(received_at) into v_at from public.emails where thread_id = new.thread_id; end if;
  if v_at is null and new.order_id is not null then select order_date::timestamptz into v_at from public.orders where id = new.order_id; end if;
  if v_at is not null and v_at < public.park_cutoff() then new.parked_at := now(); end if;
  return new;
end $$;
drop trigger if exists tasks_park_old on public.tasks;
create trigger tasks_park_old before insert on public.tasks for each row execute function public.tasks_park_old();

create or replace function public.review_items_park_old() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_at timestamptz;
begin
  if new.parked_at is not null then return new; end if;
  if new.entity_type = 'email_thread' then select last_message_at into v_at from public.email_threads where id = new.entity_id;
  elsif new.entity_type = 'order' then select order_date::timestamptz into v_at from public.orders where id = new.entity_id;
  end if;
  if v_at is not null and v_at < public.park_cutoff() then new.parked_at := now(); end if;
  return new;
end $$;
drop trigger if exists review_items_park_old on public.review_items;
create trigger review_items_park_old before insert on public.review_items for each row execute function public.review_items_park_old();

-- a conversation waiting on us parks when its last message is older than the cutoff; new mail unparks it
create or replace function public.email_threads_park_old() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.last_message_at is not null and new.last_message_at < public.park_cutoff() then
    if new.status = 'waiting_on_us' then new.parked_at := coalesce(new.parked_at, now()); end if;
  elsif new.last_message_at is not null then
    new.parked_at := null;
  end if;
  return new;
end $$;
drop trigger if exists email_threads_park_old on public.email_threads;
create trigger email_threads_park_old before insert or update of last_message_at, status on public.email_threads for each row execute function public.email_threads_park_old();

-- an accounting paper needing a look parks when the paper is older than the cutoff; filing it unparks it
create or replace function public.accounting_documents_park_old() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'review' and coalesce(new.doc_date, new.created_at::date) < public.park_cutoff()::date then
    new.parked_at := coalesce(new.parked_at, now());
  elsif new.status <> 'review' then
    new.parked_at := null;
  end if;
  return new;
end $$;
drop trigger if exists accounting_documents_park_old on public.accounting_documents;
create trigger accounting_documents_park_old before insert or update of status, doc_date on public.accounting_documents for each row execute function public.accounting_documents_park_old();

-- a paperwork check parks when its email or paper is older than the cutoff
create or replace function public.order_checks_park_old() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_at timestamptz;
begin
  if new.parked_at is not null then return new; end if;
  if new.email_id is not null then select received_at into v_at from public.emails where id = new.email_id; end if;
  if v_at is null and new.doc_date is not null then v_at := new.doc_date::timestamptz; end if;
  if v_at is not null and v_at < public.park_cutoff() then new.parked_at := now(); end if;
  return new;
end $$;
drop trigger if exists order_checks_park_old on public.order_checks;
create trigger order_checks_park_old before insert on public.order_checks for each row execute function public.order_checks_park_old();

-- unpark one, or (Dana) a whole kind
create or replace function public.park_release(p_kind text, p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v_org uuid;
begin
  if not public.user_can_edit() then raise exception 'Only admins, managers and buyers unpark' using errcode = '42501'; end if;
  select organization_id into v_org from public.profiles where id = auth.uid();
  case p_kind
    when 'task' then update public.tasks set parked_at = null where id = p_id and organization_id = v_org;
    when 'review' then update public.review_items set parked_at = null where id = p_id and organization_id = v_org;
    when 'thread' then update public.email_threads set parked_at = null where id = p_id and organization_id = v_org;
    when 'document' then update public.accounting_documents set parked_at = null where id = p_id and organization_id = v_org and public.sees_accounting();
    when 'check' then update public.order_checks set parked_at = null where id = p_id and organization_id = v_org;
    else raise exception 'Unknown kind %', p_kind using errcode = '22023';
  end case;
end $$;
revoke execute on function public.park_release(text, uuid) from public, anon;
grant execute on function public.park_release(text, uuid) to authenticated;

create or replace function public.park_release_all(p_kind text) returns integer
language plpgsql security definer set search_path = public as $$
declare v_org uuid; n integer;
begin
  if not public.is_admin() then raise exception 'Only the administrator unparks everything' using errcode = '42501'; end if;
  select organization_id into v_org from public.profiles where id = auth.uid();
  case p_kind
    when 'task' then update public.tasks set parked_at = null where organization_id = v_org and parked_at is not null;
    when 'review' then update public.review_items set parked_at = null where organization_id = v_org and parked_at is not null;
    when 'thread' then update public.email_threads set parked_at = null where organization_id = v_org and parked_at is not null;
    when 'document' then update public.accounting_documents set parked_at = null where organization_id = v_org and parked_at is not null;
    when 'check' then update public.order_checks set parked_at = null where organization_id = v_org and parked_at is not null;
    else raise exception 'Unknown kind %', p_kind using errcode = '22023';
  end case;
  get diagnostics n = row_count;
  return n;
end $$;
revoke execute on function public.park_release_all(text) from public, anon;
grant execute on function public.park_release_all(text) to authenticated;

-- back-check: everything already on the lists
update public.email_threads set parked_at = now() where parked_at is null and status = 'waiting_on_us' and last_message_at < public.park_cutoff();
update public.accounting_documents set parked_at = now() where parked_at is null and status = 'review' and coalesce(doc_date, created_at::date) < public.park_cutoff()::date;
update public.tasks t set parked_at = now() where parked_at is null and done_at is null
   and coalesce((select max(received_at) from public.emails e where e.thread_id = t.thread_id), (select order_date::timestamptz from public.orders o where o.id = t.order_id)) < public.park_cutoff();
update public.review_items r set parked_at = now() where parked_at is null and status = 'pending'
   and coalesce((select last_message_at from public.email_threads th where r.entity_type = 'email_thread' and th.id = r.entity_id),
                (select order_date::timestamptz from public.orders o where r.entity_type = 'order' and o.id = r.entity_id)) < public.park_cutoff();
update public.order_checks c set parked_at = now() where parked_at is null and status in ('to_review', 'needs_order', 'failed')
   and coalesce((select received_at from public.emails e where e.id = c.email_id), c.doc_date::timestamptz) < public.park_cutoff();

-- ---- the history reader ----------------------------------------------------------------------------------------
alter table public.organizations add column if not exists read_mail_since date;
alter table public.organizations add column if not exists history_daily_cap_usd numeric(8,2) not null default 10;
update public.organizations set read_mail_since = current_date - 365 where read_mail_since is null;
comment on column public.organizations.read_mail_since is 'The oldest mail the readers (sent orders, ordering-service orders) look at; moved back a month a day by mail_history_step while the day''s Claude spend is under history_daily_cap_usd.';

-- one month further back each day, while the day's Claude spend is under the cap, down to the first email on file
create or replace function public.mail_history_step() returns integer
language plpgsql security definer set search_path = public as $$
declare o record; v_spend numeric; v_first date; n integer := 0; v_today date := (now() at time zone 'America/Los_Angeles')::date;
begin
  for o in select * from public.organizations where is_active loop
    select coalesce(sum(cost_usd), 0) into v_spend from public.ai_usage where organization_id = o.id and created_at >= v_today::timestamp at time zone 'America/Los_Angeles';
    if v_spend >= o.history_daily_cap_usd then continue; end if;
    select min(received_at)::date into v_first from public.emails where organization_id = o.id and mailbox_id is null;
    if v_first is null or o.read_mail_since <= v_first then continue; end if;
    update public.organizations set read_mail_since = greatest(v_first, (o.read_mail_since - interval '1 month')::date) where id = o.id;
    n := n + 1;
  end loop;
  return n;
end $$;
revoke execute on function public.mail_history_step() from public, anon, authenticated;
grant execute on function public.mail_history_step() to service_role;
do $$ begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule(jobid) from cron.job where jobname = 'mail-history-step';
    perform cron.schedule('mail-history-step', '5 9 * * *', $job$select public.mail_history_step()$job$);   -- 1:05 am Pacific
  end if;
end $$;

-- ordering-service order emails: back to read_mail_since, not 365 days
create or replace function public.service_order_queue(p_org uuid, p_limit integer default 10)
returns table (email_id uuid)
language sql stable security definer set search_path = public as $$
  select e.id
    from public.emails e
    left join public.email_senders s on s.id = e.sender_id
   where e.organization_id = p_org and e.direction = 'in' and e.copy_of is null and e.order_scan is null
     and e.received_at > coalesce((select read_mail_since from public.organizations where id = p_org), current_date - 365)
     and coalesce(s.kind, 'unknown') not in ('marketing', 'not_vendor', 'internal', 'carrier')
     and lower(coalesce(e.from_email, '')) not like '%amazon.%'
     and coalesce(e.subject, '') !~* '^\s*re:'
     and coalesce(e.subject, '') ~* '(order|\mpo\M).{0,80}(submitted|received|placed|confirmed|final submission)|(new|your) order (has been |was )?(received|placed|confirmed|submitted)|order confirmation|thank(s| you) for (placing )?your order|new order received|order #?[0-9a-z-]+ confirmed'
     and coalesce(e.subject, '') !~* '(shipped|shipping|delivered|out for delivery|tracking|invoice|reorder|re-order|% off|sale\M|invitation|password|back ?order|cancel|return)'
     and not exists (select 1 from public.order_checks c where c.email_id = e.id)
   order by e.received_at
   limit p_limit
$$;

-- ---- Jarrett's order conversations go to Orders ----------------------------------------------------------------
-- As before (vendor, rep group and carrier senders in staff mailboxes), and now any conversation in a staff mailbox
-- with a vendor on it, either direction: an order he emailed, a confirmation back, an invoice. Never the accounting mailbox.
create or replace function public.share_vendor_threads(p_org uuid, p_email uuid default null, p_sender uuid default null)
returns integer language plpgsql security definer set search_path = public as $$
declare n integer; n2 integer;
begin
  with hit as (
    select distinct e.thread_id, m.kind as box_kind
      from public.emails e
      join public.email_senders s on s.id = e.sender_id and s.kind in ('vendor', 'rep_group', 'carrier')
      join public.mailboxes m on m.id = e.mailbox_id and m.auto_share_vendor_mail
     where e.organization_id = p_org and e.direction = 'in' and e.mailbox_id is not null and e.thread_id is not null
       and (p_email is null or e.id = p_email)
       and (p_sender is null or e.sender_id = p_sender)
       and (p_email is not null or e.received_at > now() - interval '365 days')
       and (m.kind <> 'accounting' or s.kind in ('vendor', 'rep_group'))
  )
  update public.email_threads t set shared_at = now()
    from hit
   where t.id = hit.thread_id and t.mailbox_id is not null and t.shared_at is null and not t.auto_share_off
     and (hit.box_kind <> 'accounting' or public.accounting_thread_only_vendor(t.id));
  get diagnostics n = row_count;
  -- staff mailboxes: every conversation with a vendor on it (Dana, Nov 10: Jarrett's orders, placed or to be placed)
  update public.email_threads t set shared_at = now()
    from public.mailboxes m
   where t.organization_id = p_org and t.mailbox_id = m.id and m.kind = 'personal' and m.auto_share_vendor_mail
     and t.shared_at is null and not t.auto_share_off
     and (p_email is null or exists (select 1 from public.emails e where e.id = p_email and e.thread_id = t.id))
     and exists (select 1 from public.emails e where e.thread_id = t.id and e.vendor_id is not null);
  get diagnostics n2 = row_count;
  return n + n2;
end;
$$;
revoke execute on function public.share_vendor_threads(uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.share_vendor_threads(uuid, uuid, uuid) to service_role;
do $$ declare o record; begin
  for o in select id from public.organizations where is_active loop perform public.share_vendor_threads(o.id); end loop;
end $$;
