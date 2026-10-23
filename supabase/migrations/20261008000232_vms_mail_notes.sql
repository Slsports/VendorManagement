-- 0232 — "VMS:" notes in email (Dana, Oct 23): "If I forward an email to my dana@sls and say … Please create a task reminder
-- and create an email to check on these backorder items. I would like one on Nov 1, 2026, December 15, 2026, January 30,
-- 2027 & March 21, 2027. Can it take the content in the email to create a task with the correct reminders and links to
-- the emails and vendors?" … "I think it should only activate if I say VMS: blah blah".
--
--   • A note is read only when all three hold: the email's text starts with "VMS:", it is from one of us (staff login or
--     our own address), and it went to one of our own mailboxes (never the accounting mailbox). One note per message,
--     however many mailboxes hold a copy.
--   • mail-commands (every minute) reads the note and the email under it with Claude: one task per date, reminding that
--     morning, tagged to the vendor, linked to the email, each with an email to the vendor ready in Drafts; then it emails
--     the person what it made, or asks when it can't tell.
--   • Sending a task's email ticks that task done (by the sender) and VMS watches that conversation: when the vendor says
--     everything shipped (or can't be had), the rest of the tasks close (Closed by VMS, with why).

set local lock_timeout = '5s';

create table if not exists public.mail_commands (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations(id) on delete cascade,
  email_id         uuid not null references public.emails(id) on delete cascade,
  message_key      text not null,
  person_id        uuid not null references public.profiles(id) on delete cascade,
  status           text not null default 'waiting' check (status in ('waiting', 'working', 'done', 'asked', 'failed')),
  vendor_id        uuid references public.vendors(id) on delete set null,
  thread_id        uuid references public.email_threads(id) on delete set null,
  summary          text,
  result           jsonb,
  watch_thread_ids uuid[] not null default '{}',
  watched_at       timestamptz,
  error            text,
  working_at       timestamptz,
  created_at       timestamptz not null default now(),
  done_at          timestamptz,
  unique (organization_id, message_key)
);
comment on table public.mail_commands is 'A "VMS:" note one of us sent to our own mailbox: what VMS made from it (tasks, emails ready to send), or what it asked.';
create index if not exists mail_commands_waiting on public.mail_commands (created_at) where status in ('waiting', 'working');
create index if not exists mail_commands_watching on public.mail_commands using gin (watch_thread_ids);
alter table public.mail_commands enable row level security;
drop policy if exists "mail_commands: mine or admin" on public.mail_commands;
create policy "mail_commands: mine or admin" on public.mail_commands for select to authenticated
  using (public.user_in_org(organization_id) and (person_id = auth.uid() or public.is_admin()));
grant select on public.mail_commands to authenticated;
grant all on public.mail_commands to service_role;

-- the email a task is about to send (opens straight in the compose box)
alter table public.tasks add column if not exists draft_id uuid references public.email_drafts(id) on delete set null;
comment on column public.tasks.draft_id is 'An email ready to send for this task (Mail › Drafts); sending it ticks the task done.';

/** Who wrote it: a staff login, or one of the organization's own addresses (the admin's). */
create or replace function public.mail_command_person(p_org uuid, p_email text) returns uuid
language sql stable security definer set search_path = public as $$
  select coalesce(
    (select p.id from public.profiles p where p.organization_id = p_org and p.is_active and lower(p.email) = lower(trim(p_email)) limit 1),
    (select p.id from public.profiles p join public.organizations o on o.id = p.organization_id
      where p.organization_id = p_org and p.role = 'admin' and p.is_active
        and lower(trim(p_email)) = any (select lower(x) from unnest(coalesce(o.own_addresses, '{}')) x)
      order by p.created_at limit 1));
$$;
revoke execute on function public.mail_command_person(uuid, text) from public, anon, authenticated;
grant execute on function public.mail_command_person(uuid, text) to service_role;

/** New "VMS:" notes in the last three days, one per message. */
create or replace function public.mail_commands_find(p_org uuid) returns integer
language plpgsql security definer set search_path = public as $$
declare n integer;
begin
  insert into public.mail_commands (organization_id, email_id, message_key, person_id, thread_id, vendor_id)
  select distinct on (coalesce(nullif(e.message_id_header, ''), e.id::text))
         e.organization_id, e.id, coalesce(nullif(e.message_id_header, ''), e.id::text), public.mail_command_person(e.organization_id, e.from_email), e.thread_id, e.vendor_id
    from public.emails e
    left join public.mailboxes b on b.id = e.mailbox_id
   where e.organization_id = p_org and e.received_at > now() - interval '3 days' and e.copy_of is null
     and e.body_text ~* '^\s*vms\s*:'
     and (b.id is null or b.kind <> 'accounting')
     and public.is_our_address(e.organization_id, e.from_email)
     and exists (select 1 from unnest(e.to_emails || e.cc_emails) a where public.is_our_address(e.organization_id, a))
     and public.mail_command_person(e.organization_id, e.from_email) is not null
   order by coalesce(nullif(e.message_id_header, ''), e.id::text), (e.mailbox_id is null) desc, e.received_at
  on conflict (organization_id, message_key) do nothing;
  get diagnostics n = row_count;
  return n;
end;
$$;
revoke execute on function public.mail_commands_find(uuid) from public, anon, authenticated;
grant execute on function public.mail_commands_find(uuid) to service_role;

/** The next note to read, claimed for 5 minutes. */
create or replace function public.mail_command_next(p_org uuid) returns setof public.mail_commands
language plpgsql security definer set search_path = public as $$
declare c public.mail_commands%rowtype;
begin
  select * into c from public.mail_commands x
   where x.organization_id = p_org and (x.status = 'waiting' or (x.status = 'working' and x.working_at < now() - interval '5 minutes'))
   order by x.created_at limit 1 for update skip locked;
  if c.id is null then return; end if;
  update public.mail_commands set status = 'working', working_at = now() where id = c.id returning * into c;
  return next c;
end;
$$;
revoke execute on function public.mail_command_next(uuid) from public, anon, authenticated;
grant execute on function public.mail_command_next(uuid) to service_role;

/**
 * What VMS made from a note: one task per entry of p_tasks ([{due, remind_at, title, notes, draft: {to, cc, subject,
 * body} | null}]), each for the person who wrote the note, tagged to the vendor and linked to the email. Returns the tasks.
 */
create or replace function public.mail_command_make(p_cmd uuid, p_vendor uuid, p_summary text, p_tasks jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  c     public.mail_commands%rowtype;
  t     jsonb;
  n     integer := 0;
  v_d   uuid;
  v_t   uuid;
  out   jsonb := '[]'::jsonb;
begin
  select * into c from public.mail_commands where id = p_cmd for update;
  if not found or c.status not in ('working', 'waiting') then return null; end if;
  if p_vendor is not null and not exists (select 1 from public.vendors where id = p_vendor and organization_id = c.organization_id) then p_vendor := null; end if;
  if jsonb_typeof(p_tasks) <> 'array' or jsonb_array_length(p_tasks) = 0 or jsonb_array_length(p_tasks) > 12 then raise exception 'One to twelve tasks' using errcode = '22023'; end if;
  for t in select * from jsonb_array_elements(p_tasks) loop
    n := n + 1;
    v_d := null;
    if jsonb_typeof(t->'draft') = 'object' and jsonb_array_length(coalesce(t->'draft'->'to', '[]')) > 0 then
      insert into public.email_drafts (organization_id, owner_id, created_by, to_emails, cc_emails, subject, body, vendor_id, note)
      values (c.organization_id, c.person_id, null,
              array(select lower(trim(x)) from jsonb_array_elements_text(t->'draft'->'to') x),
              array(select lower(trim(x)) from jsonb_array_elements_text(coalesce(t->'draft'->'cc', '[]')) x),
              left(t->'draft'->>'subject', 300), t->'draft'->>'body', p_vendor,
              format('From your VMS: note · %s', t->>'due'))
      returning id into v_d;
    end if;
    insert into public.tasks (organization_id, title, notes, due_date, remind_at, assigned_to, created_by, vendor_id, thread_id, auto_key, draft_id)
    values (c.organization_id, left(t->>'title', 200), t->>'notes', (t->>'due')::date, (t->>'remind_at')::timestamptz,
            c.person_id, c.person_id, p_vendor, c.thread_id, format('vmscmd:%s:%s', c.id, n), v_d)
    returning id into v_t;
    out := out || jsonb_build_object('task_id', v_t, 'due', t->>'due', 'draft_id', v_d);
  end loop;
  update public.mail_commands set status = 'done', vendor_id = p_vendor, summary = left(p_summary, 300), result = out, done_at = now(), working_at = null
   where id = c.id;
  return out;
end;
$$;
revoke execute on function public.mail_command_make(uuid, uuid, text, jsonb) from public, anon, authenticated;
grant execute on function public.mail_command_make(uuid, uuid, text, jsonb) to service_role;

create or replace function public.mail_command_finish(p_cmd uuid, p_status text, p_summary text, p_error text default null) returns void
language sql security definer set search_path = public as $$
  update public.mail_commands set status = p_status, summary = left(coalesce(p_summary, summary), 300), error = left(p_error, 500), working_at = null, done_at = now()
   where id = p_cmd and p_status in ('asked', 'failed', 'done');
$$;
revoke execute on function public.mail_command_finish(uuid, text, text, text) from public, anon, authenticated;
grant execute on function public.mail_command_finish(uuid, text, text, text) to service_role;

/**
 * gmail-send, after a draft went: its task is done (by whoever sent it) and VMS watches that conversation for the
 * vendor's answer.
 */
create or replace function public.mail_command_sent(p_draft uuid, p_email uuid, p_by uuid) returns void
language plpgsql security definer set search_path = public as $$
declare t public.tasks%rowtype; e public.emails%rowtype;
begin
  select * into t from public.tasks where draft_id = p_draft limit 1;
  if not found then return; end if;
  select * into e from public.emails where id = p_email;
  update public.tasks set done_at = coalesce(done_at, now()), done_by = coalesce(done_by, p_by), done_note = coalesce(done_note, 'Email sent'),
         thread_id = coalesce(e.thread_id, thread_id), draft_id = null
   where id = t.id;
  if t.auto_key like 'vmscmd:%' and e.thread_id is not null then
    update public.mail_commands set watch_thread_ids = array(select distinct x from unnest(watch_thread_ids || e.thread_id) x), watched_at = coalesce(watched_at, now())
     where id = split_part(t.auto_key, ':', 2)::uuid;
  end if;
end;
$$;
revoke execute on function public.mail_command_sent(uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.mail_command_sent(uuid, uuid, uuid) to service_role;

/** Notes whose watched conversations have a new email from the vendor since the last look (one at a time). */
create or replace function public.mail_command_replies(p_org uuid)
returns table (command_id uuid, person_id uuid, vendor_id uuid, summary text, email_ids uuid[])
language sql stable security definer set search_path = public as $$
  select c.id, c.person_id, c.vendor_id, c.summary,
         (select array_agg(e.id order by e.received_at) from public.emails e
           where e.thread_id = any (c.watch_thread_ids) and e.direction = 'in' and e.received_at > c.watched_at
             and not public.is_our_address(e.organization_id, e.from_email))
    from public.mail_commands c
   where c.organization_id = p_org and c.status = 'done' and cardinality(c.watch_thread_ids) > 0
     and exists (select 1 from public.tasks t where t.auto_key like 'vmscmd:' || c.id || ':%' and t.done_at is null)
     and exists (select 1 from public.emails e where e.thread_id = any (c.watch_thread_ids) and e.direction = 'in' and e.received_at > c.watched_at
                   and not public.is_our_address(e.organization_id, e.from_email))
   order by c.watched_at limit 3;
$$;
revoke execute on function public.mail_command_replies(uuid) from public, anon, authenticated;
grant execute on function public.mail_command_replies(uuid) to service_role;

/** The vendor answered: close the open tasks of the note (p_close) with why, and look again only at later mail. */
create or replace function public.mail_command_answered(p_cmd uuid, p_close boolean, p_why text) returns integer
language plpgsql security definer set search_path = public as $$
declare n integer := 0;
begin
  if p_close then
    update public.tasks set done_at = now(), done_note = left(p_why, 300), closed_how = 'vms'
     where auto_key like 'vmscmd:' || p_cmd || ':%' and done_at is null;
    get diagnostics n = row_count;
  end if;
  update public.mail_commands set watched_at = now() where id = p_cmd;
  return n;
end;
$$;
revoke execute on function public.mail_command_answered(uuid, boolean, text) from public, anon, authenticated;
grant execute on function public.mail_command_answered(uuid, boolean, text) to service_role;
