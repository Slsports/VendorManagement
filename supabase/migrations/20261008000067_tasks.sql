-- 0088 — Tasks (Dana, Oct 11): "a task list that we can add things we need to do … a date, to do item and when you
-- want to be reminded and the ability to tag it to a vendor, freight co, or something else … and I could assign it
-- to someone else." Each person sees the tasks assigned to them or that they assigned; the admin sees everyone's.
-- Reminders go out by dashboard, email and/or text, each person's choice (default dashboard + email). Tasks can
-- repeat: every N days, weeks (on chosen weekdays), months or years, until an optional end date; finishing one
-- makes the next. When someone finishes a task another person gave them, the giver is told the same ways.
create table if not exists public.tasks (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations(id) on delete cascade,
  title            text not null check (length(trim(title)) > 0),
  notes            text,
  due_date         date,
  remind_at        timestamptz,
  assigned_to      uuid not null references public.profiles(id) on delete cascade,
  created_by       uuid references public.profiles(id) on delete set null,
  -- what it is about (any or none)
  vendor_id        uuid references public.vendors(id) on delete set null,
  carrier_id       uuid references public.carriers(id) on delete set null,
  order_id         uuid references public.orders(id) on delete set null,
  thread_id        uuid references public.email_threads(id) on delete set null,
  rep_group_id     uuid references public.rep_groups(id) on delete set null,
  tag_other        text,
  -- repeating
  repeat_every     integer check (repeat_every is null or repeat_every between 1 and 365),
  repeat_unit      text check (repeat_unit in ('day', 'week', 'month', 'year')),
  repeat_days      smallint[] not null default '{}',
  repeat_until     date,
  repeat_of        uuid references public.tasks(id) on delete set null,
  -- reminders and finishing
  reminded_at      timestamptz,
  reminder_seen_at timestamptz,
  remind_error     text,
  done_at          timestamptz,
  done_by          uuid references public.profiles(id) on delete set null,
  done_note        text,
  done_notified_at timestamptz,
  done_seen_at     timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  check ((repeat_every is null) = (repeat_unit is null)),
  check (repeat_every is null or due_date is not null)
);
create index if not exists tasks_assigned_idx on public.tasks (assigned_to, due_date) where done_at is null;
create index if not exists tasks_created_idx on public.tasks (created_by) where done_at is null;
create index if not exists tasks_remind_idx on public.tasks (remind_at) where done_at is null and reminded_at is null;
create index if not exists tasks_vendor_idx on public.tasks (vendor_id) where vendor_id is not null;
create index if not exists tasks_order_idx on public.tasks (order_id) where order_id is not null;
create index if not exists tasks_thread_idx on public.tasks (thread_id) where thread_id is not null;
drop trigger if exists tasks_updated_at on public.tasks;
create trigger tasks_updated_at before update on public.tasks for each row execute function public.set_updated_at();

-- How each person is reminded (any combination): dashboard and email by default; texts need a mobile number.
alter table public.profiles add column if not exists remind_dashboard boolean not null default true;
alter table public.profiles add column if not exists remind_email boolean not null default true;
alter table public.profiles add column if not exists remind_text boolean not null default false;
alter table public.profiles add column if not exists mobile_phone text;

-- Keep a task honest: the assignee is in the same organization; a new remind time sends a new reminder; a reopened
-- task forgets it was done.
create or replace function public.tasks_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from public.profiles p where p.id = new.assigned_to and p.organization_id = new.organization_id) then
    raise exception 'That person is not in this organization' using errcode = '23503';
  end if;
  if tg_op = 'INSERT' then
    new.created_by := coalesce(auth.uid(), new.created_by);
    new.reminded_at := null; new.reminder_seen_at := null; new.done_notified_at := null; new.done_seen_at := null;
  else
    if new.remind_at is distinct from old.remind_at or (new.assigned_to <> old.assigned_to and old.reminded_at is null) then
      new.reminded_at := null; new.reminder_seen_at := null; new.remind_error := null;
    end if;
    if new.done_at is null and old.done_at is not null then
      new.done_by := null; new.done_note := null; new.done_notified_at := null; new.done_seen_at := null;
    end if;
  end if;
  if new.repeat_unit is distinct from 'week' then new.repeat_days := '{}'; end if;
  return new;
end;
$$;
drop trigger if exists tasks_guard on public.tasks;
create trigger tasks_guard before insert or update on public.tasks for each row execute function public.tasks_guard();

alter table public.tasks enable row level security;
drop policy if exists "tasks: mine, given or admin" on public.tasks;
create policy "tasks: mine, given or admin" on public.tasks for select to authenticated
  using (public.user_in_org(organization_id) and (assigned_to = auth.uid() or created_by = auth.uid() or public.is_admin()));
drop policy if exists "tasks: members add" on public.tasks;
create policy "tasks: members add" on public.tasks for insert to authenticated
  with check (public.user_in_org(organization_id));
drop policy if exists "tasks: mine, given or admin change" on public.tasks;
create policy "tasks: mine, given or admin change" on public.tasks for update to authenticated
  using (public.user_in_org(organization_id) and (assigned_to = auth.uid() or created_by = auth.uid() or public.is_admin()))
  with check (public.user_in_org(organization_id));
drop policy if exists "tasks: giver or admin delete" on public.tasks;
create policy "tasks: giver or admin delete" on public.tasks for delete to authenticated
  using (public.user_in_org(organization_id) and (created_by = auth.uid() or assigned_to = auth.uid() or public.is_admin()));
grant select, insert, update, delete on table public.tasks to authenticated;
grant all on table public.tasks to service_role;

-- The next due date of a repeating task. Weeks with chosen weekdays (0 = Sunday … 6 = Saturday): the next chosen
-- day later in the same week, else the first chosen day N weeks on.
create or replace function public.task_next_due(p_due date, p_every integer, p_unit text, p_days smallint[] default '{}')
returns date
language plpgsql immutable set search_path = public as $$
declare
  dow int := extract(dow from p_due)::int;
  later int;
  first_day int;
begin
  if p_due is null or p_every is null or p_unit is null then return null; end if;
  if p_unit = 'day' then return p_due + p_every; end if;
  if p_unit = 'month' then return (p_due + make_interval(months => p_every))::date; end if;
  if p_unit = 'year' then return (p_due + make_interval(years => p_every))::date; end if;
  if coalesce(array_length(p_days, 1), 0) = 0 then return p_due + 7 * p_every; end if;
  select min(d) into later from unnest(p_days) d where d > dow;
  if later is not null then return p_due + (later - dow); end if;
  select min(d) into first_day from unnest(p_days) d;
  return p_due - dow + 7 * p_every + first_day;
end;
$$;
grant execute on function public.task_next_due(date, integer, text, smallint[]) to authenticated, service_role;

-- Finish a task (with an optional note for whoever gave it). A repeating task makes its next one, reminded the same
-- time before it is due; returns that next task's id.
create or replace function public.complete_task(p_task uuid, p_note text default null)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  t public.tasks%rowtype;
  next_due date;
  next_id uuid;
begin
  select * into t from public.tasks where id = p_task for update;
  if t.id is null or not public.user_in_org(t.organization_id) or not (t.assigned_to = auth.uid() or t.created_by = auth.uid() or public.is_admin()) then
    raise exception 'Task not found' using errcode = '23503';
  end if;
  if t.done_at is not null then return null; end if;
  update public.tasks set done_at = now(), done_by = auth.uid(), done_note = nullif(trim(p_note), ''),
    -- your own task, or finished by the one who gave it: nobody needs telling
    done_notified_at = case when t.created_by is null or t.created_by = auth.uid() then now() end,
    done_seen_at = case when t.created_by is null or t.created_by = auth.uid() then now() end
  where id = p_task;
  if t.repeat_every is not null then
    next_due := public.task_next_due(t.due_date, t.repeat_every, t.repeat_unit, t.repeat_days);
    -- a late finish skips the dates already gone
    while next_due < current_date loop
      next_due := public.task_next_due(next_due, t.repeat_every, t.repeat_unit, t.repeat_days);
    end loop;
    if t.repeat_until is null or next_due <= t.repeat_until then
      insert into public.tasks (organization_id, title, notes, due_date, remind_at, assigned_to, created_by, vendor_id, carrier_id, order_id,
        thread_id, rep_group_id, tag_other, repeat_every, repeat_unit, repeat_days, repeat_until, repeat_of)
      values (t.organization_id, t.title, t.notes, next_due,
        case when t.remind_at is not null then t.remind_at + (next_due - t.due_date) * interval '1 day' end,
        t.assigned_to, t.created_by, t.vendor_id, t.carrier_id, t.order_id, t.thread_id, t.rep_group_id, t.tag_other,
        t.repeat_every, t.repeat_unit, t.repeat_days, t.repeat_until, t.id)
      returning id into next_id;
      -- the next one keeps the original giver
      update public.tasks set created_by = t.created_by where id = next_id;
    end if;
  end if;
  return next_id;
end;
$$;
revoke execute on function public.complete_task(uuid, text) from public, anon;
grant execute on function public.complete_task(uuid, text) to authenticated, service_role;
