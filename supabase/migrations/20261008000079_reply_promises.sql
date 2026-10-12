-- 0100 — Our own promises (Dana, Oct 12): "WFS wrote me wanting to confirm our order, I wrote back and said I would
-- be able to look at it tomorrow. The status changed to 'waiting on vendor'. No one is waiting on the vendor, it should
-- go into my tasks list with the due date being end of business tomorrow" (end of business = 6 pm).
-- Claude reads our latest reply in each orders@ conversation. When it promises something from our side, the
-- conversation stays "waiting on us" and the person who signed it gets a task (auto_key promise:<email>) due that day,
-- tagged to the vendor and the conversation. Finishing the task, or sending another reply, ends the promise.

alter table public.emails add column if not exists promise_read_at timestamptz;
alter table public.emails add column if not exists promise jsonb;
comment on column public.emails.promise is 'Claude''s reading of our own reply: {promise, task, due, quote, writer}.';

-- Our replies to read: the newest message of an orders@ conversation, from us, in the last two weeks. Service role only.
create or replace function public.mail_promise_queue(p_org uuid, p_limit integer default 20)
returns table (email_id uuid, thread_id uuid, subject text, body_text text, sent_at timestamptz, vendor text, their_last text)
language sql stable security definer
set search_path = public
as $$
  select e.id, e.thread_id, e.subject, left(e.body_text, 2500), e.received_at, v.name,
         (select left(coalesce(i.body_text, i.snippet), 800) from public.emails i where i.thread_id = e.thread_id and i.direction = 'in' and i.received_at < e.received_at order by i.received_at desc limit 1)
    from public.emails e
    join public.email_threads t on t.id = e.thread_id
    left join public.vendors v on v.id = t.vendor_id
   where e.organization_id = p_org and e.direction = 'out' and e.promise_read_at is null
     and e.mailbox_id is null and t.mailbox_id is null and t.deleted_at is null
     and e.received_at > now() - interval '14 days'
     and e.id = (select x.id from public.emails x where x.thread_id = e.thread_id and x.direction <> 'internal' order by x.received_at desc limit 1)
   order by e.received_at desc
   limit p_limit
$$;

-- Store Claude's reading; a promise keeps the conversation on us and makes the task. Returns the task id or null.
create or replace function public.mail_apply_promise(p_email uuid, p_promise boolean, p_task text, p_due date, p_quote text, p_writer text)
returns uuid
language plpgsql security definer
set search_path = public
as $$
declare
  e       public.emails%rowtype;
  t       public.email_threads%rowtype;
  v_who   uuid;
  v_task  uuid;
  v_due   date;
begin
  select * into e from public.emails where id = p_email;
  if not found then return null; end if;
  update public.emails set promise_read_at = now(),
    promise = jsonb_build_object('promise', p_promise, 'task', p_task, 'due', p_due, 'quote', left(p_quote, 300), 'writer', p_writer)
   where id = p_email;
  if not coalesce(p_promise, false) then return null; end if;
  select * into t from public.email_threads where id = e.thread_id;
  -- only while this reply is still the newest message
  if exists (select 1 from public.emails x where x.thread_id = e.thread_id and x.direction <> 'internal' and x.received_at > e.received_at) then return null; end if;

  -- who promised: whoever signed it, else who sent it from VMS, else the conversation's owner, else the admin
  select p.id into v_who from public.profiles p
   where p.organization_id = e.organization_id and p.is_active and nullif(trim(p_writer), '') is not null
     and lower(split_part(p.full_name, ' ', 1)) = lower(split_part(trim(p_writer), ' ', 1))
   order by p.created_at limit 1;
  v_who := coalesce(v_who, e.sent_by, t.owner_id, public.org_admin(e.organization_id));
  if v_who is null then return null; end if;
  v_due := coalesce(p_due, (e.received_at at time zone 'America/Los_Angeles')::date + 1);

  insert into public.tasks (organization_id, title, notes, due_date, remind_at, assigned_to, vendor_id, thread_id, auto_key)
  values (e.organization_id, left(coalesce(nullif(trim(p_task), ''), 'Follow up: ' || coalesce(t.subject, 'email')), 200),
          concat_ws(E'\n', 'Due by end of business (6 pm).', case when p_quote is not null then 'You wrote: "' || left(p_quote, 300) || '"' end),
          v_due, (v_due + time '09:00') at time zone 'America/Los_Angeles', v_who, t.vendor_id, t.id, 'promise:' || e.id)
  on conflict (organization_id, auto_key) where auto_key is not null do nothing
  returning id into v_task;

  update public.email_threads set status = 'waiting_on_us', follow_up_at = null where id = t.id;
  return v_task;
end;
$$;
revoke execute on function public.mail_promise_queue(uuid, integer), public.mail_apply_promise(uuid, boolean, text, date, text, text) from public, anon, authenticated;
grant execute on function public.mail_promise_queue(uuid, integer), public.mail_apply_promise(uuid, boolean, text, date, text, text) to service_role;

-- Status: a reply of ours with an open promise task keeps the conversation on us. Another reply ends the old promise.
create or replace function public.mail_refresh_thread(p_thread uuid, p_backfill boolean default false)
returns void
language plpgsql security definer
set search_path = public
as $$
declare
  t        public.email_threads%rowtype;
  last_e   public.emails%rowtype;
  v_vendor uuid;
  v_days   integer;
  v_owner  uuid;
  v_promise boolean;
begin
  select * into t from public.email_threads where id = p_thread for update;
  if not found then return; end if;
  if t.vendor_id is null then
    select vendor_id into v_vendor from public.emails where thread_id = p_thread and vendor_id is not null
     group by vendor_id order by count(*) desc, max(received_at) desc limit 1;
  end if;
  update public.email_threads th set
    vendor_id       = coalesce(th.vendor_id, v_vendor),
    message_count   = (select count(*) from public.emails where thread_id = p_thread),
    subject         = coalesce(th.subject, (select subject from public.emails where thread_id = p_thread order by received_at limit 1)),
    last_in_at      = (select max(received_at) from public.emails where thread_id = p_thread and direction = 'in'),
    last_out_at     = (select max(received_at) from public.emails where thread_id = p_thread and direction = 'out'),
    last_message_at = (select max(received_at) from public.emails where thread_id = p_thread)
  where th.id = p_thread
  returning * into t;

  select * into last_e from public.emails where thread_id = p_thread and direction <> 'internal' order by received_at desc limit 1;
  if last_e.id is not null and last_e.received_at > coalesce(t.status_msg_at, '-infinity'::timestamptz) then
    -- a newer reply of ours ends the promises made in earlier ones
    if last_e.direction = 'out' then
      update public.tasks set done_at = now(), done_note = 'Replied again'
       where thread_id = p_thread and done_at is null and auto_key like 'promise:%' and auto_key <> 'promise:' || last_e.id;
    end if;
    v_promise := last_e.direction = 'out' and exists (select 1 from public.tasks where auto_key = 'promise:' || last_e.id and done_at is null);
    select follow_up_days into v_days from public.mail_accounts where organization_id = t.organization_id;
    update public.email_threads set
      status = case when p_backfill and last_e.received_at < now() - interval '7 days' then 'handled'
                    when last_e.direction = 'in' or v_promise then 'waiting_on_us' else 'waiting_on_vendor' end,
      follow_up_at = case when last_e.direction = 'out' and not v_promise and not (p_backfill and last_e.received_at < now() - interval '7 days')
                          then last_e.received_at + make_interval(days => coalesce(v_days, 5)) end,
      status_msg_at = last_e.received_at
    where id = p_thread;
  end if;

  -- Fill the owner once there is one to give; every later message follows it.
  if t.owner_id is null then
    v_owner := public.mail_default_owner(p_thread);
    if v_owner is not null then update public.email_threads set owner_id = v_owner, owner_set_at = now() where id = p_thread; end if;
  end if;

  -- Messages in a vendor's thread belong to that vendor.
  update public.emails e set vendor_id = t.vendor_id, match_how = 'thread'
   where e.thread_id = p_thread and e.vendor_id is null and t.vendor_id is not null;
end;
$$;

-- Finishing a promise task: if that reply is still the newest message, the conversation waits on the vendor again.
create or replace function public.tasks_promise_done() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_days integer;
begin
  if new.done_at is not null and old.done_at is null and new.thread_id is not null and new.auto_key like 'promise:%'
     and coalesce(new.done_note, '') <> 'Replied again'
     and exists (select 1 from public.emails x where x.id::text = substring(new.auto_key from 9)
                  and x.id = (select y.id from public.emails y where y.thread_id = new.thread_id and y.direction <> 'internal' order by y.received_at desc limit 1)) then
    select follow_up_days into v_days from public.mail_accounts where organization_id = new.organization_id;
    update public.email_threads set status = 'waiting_on_vendor', follow_up_at = now() + make_interval(days => coalesce(v_days, 5))
     where id = new.thread_id and status = 'waiting_on_us';
  end if;
  return null;
end;
$$;
drop trigger if exists tasks_promise_done on public.tasks;
create trigger tasks_promise_done after update of done_at on public.tasks for each row execute function public.tasks_promise_done();
revoke execute on function public.tasks_promise_done() from public, anon, authenticated;

-- Start with the last two days' replies (today's WFS reply among them); older ones are not read, so no stale tasks.
update public.emails set promise_read_at = now()
 where direction = 'out' and promise_read_at is null and received_at < now() - interval '2 days';
