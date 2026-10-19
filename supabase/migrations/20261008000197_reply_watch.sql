-- 0197 — "Tell me when they reply" (Dana, Oct 19: "flag that email from Nichole so you can tell me when she has
-- responded"). Anyone can watch the outside person on an email. The first email from that address after the watch
-- was set becomes a task for the watcher, reminded at once (dashboard, email and/or text, as each person chose), and
-- the task opens that reply. One reply ends the watch.
--   • A reply the watcher can't open (someone else's private mail, Accounting without the tick) never fires it.
--   • Old mail loaded from history never fires it: only mail received after the watch was set.

create table if not exists public.mail_watches (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  watcher         uuid not null references public.profiles(id) on delete cascade,
  address         text not null check (address = lower(trim(address)) and address like '%@%'),
  name            text,
  thread_id       uuid references public.email_threads(id) on delete set null,  -- where it was set
  created_at      timestamptz not null default now(),
  fired_at        timestamptz,
  fired_email_id  uuid references public.emails(id) on delete set null,
  task_id         uuid references public.tasks(id) on delete set null
);
comment on table public.mail_watches is 'Tell me when they reply: the first email from address after created_at becomes a task for watcher.';
create unique index if not exists mail_watches_open on public.mail_watches (watcher, address) where fired_at is null;
create index if not exists mail_watches_address on public.mail_watches (organization_id, address) where fired_at is null;

alter table public.mail_watches enable row level security;
drop policy if exists "mail_watches: own" on public.mail_watches;
create policy "mail_watches: own" on public.mail_watches for select to authenticated
  using (public.user_in_org(organization_id) and watcher = auth.uid());
grant select on table public.mail_watches to authenticated;
grant all on table public.mail_watches to service_role;

-- Start (or keep) a watch on the outside person of an email you can open.
create or replace function public.mail_watch_set(p_thread uuid, p_address text, p_name text default null)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_org uuid;
  v_addr text := lower(trim(p_address));
  v_id uuid;
begin
  select organization_id into v_org from public.email_threads t
   where t.id = p_thread and public.user_in_org(t.organization_id)
     and (t.mailbox_id is null or t.shared_at is not null or public.can_see_mailbox(t.mailbox_id));
  if v_org is null then raise exception 'Conversation not found' using errcode = '42501'; end if;
  if v_addr is null or v_addr not like '%@%' then raise exception 'No email address to watch' using errcode = '22023'; end if;
  select id into v_id from public.mail_watches where watcher = auth.uid() and address = v_addr and fired_at is null;
  if v_id is not null then return v_id; end if;
  insert into public.mail_watches (organization_id, watcher, address, name, thread_id)
  values (v_org, auth.uid(), v_addr, nullif(trim(p_name), ''), p_thread)
  returning id into v_id;
  return v_id;
end;
$$;
revoke execute on function public.mail_watch_set(uuid, text, text) from public, anon;
grant execute on function public.mail_watch_set(uuid, text, text) to authenticated;

create or replace function public.mail_watch_stop(p_id uuid)
returns void
language sql security definer set search_path = public as $$
  delete from public.mail_watches where id = p_id and watcher = auth.uid() and fired_at is null
$$;
revoke execute on function public.mail_watch_stop(uuid) from public, anon;
grant execute on function public.mail_watch_stop(uuid) to authenticated;

-- A new email in: fire the open watches on its sender that the watcher may see.
create or replace function public.mail_watch_fire()
returns trigger
language plpgsql security definer set search_path = public as $$
declare
  w record;
  v_box public.mailboxes%rowtype;
  v_shared boolean;
  v_task uuid;
begin
  if new.direction <> 'in' or new.from_email is null then return null; end if;
  if not exists (select 1 from public.mail_watches where organization_id = new.organization_id and address = lower(new.from_email) and fired_at is null) then
    return null;
  end if;
  select shared_at is not null into v_shared from public.email_threads where id = new.thread_id;
  if new.mailbox_id is not null then select * into v_box from public.mailboxes where id = new.mailbox_id; end if;
  for w in
    select mw.*, p.role, coalesce(p.sees_accounting, false) as sees_accounting
      from public.mail_watches mw join public.profiles p on p.id = mw.watcher
     where mw.organization_id = new.organization_id and mw.address = lower(new.from_email)
       and mw.fired_at is null and mw.created_at < new.received_at
  loop
    if new.mailbox_id is not null and not coalesce(v_shared, false) and not (
         case when v_box.kind = 'accounting' then w.sees_accounting else (v_box.owner_id = w.watcher or w.role = 'admin') end) then
      continue;
    end if;
    update public.mail_watches set fired_at = now(), fired_email_id = new.id where id = w.id and fired_at is null;
    if not found then continue; end if;
    insert into public.tasks (organization_id, title, notes, due_date, remind_at, assigned_to, created_by, thread_id, auto_key, area)
    values (new.organization_id, 'Reply from ' || coalesce(nullif(w.name, ''), nullif(new.from_name, ''), new.from_email),
            'You asked VMS to tell you when they wrote back.', (now() at time zone 'America/Los_Angeles')::date, now(),
            w.watcher, w.watcher, new.thread_id, 'reply:' || w.id,
            case when v_box.kind = 'accounting' then 'accounting' else 'general' end)
    returning id into v_task;
    update public.mail_watches set task_id = v_task where id = w.id;
  end loop;
  return null;
end;
$$;
drop trigger if exists emails_mail_watch on public.emails;
create trigger emails_mail_watch after insert on public.emails for each row execute function public.mail_watch_fire();
