-- Can see (Dana, Oct 18): Dana ticks, per person, whose work they can see. Trevor and Jarrett see each other so either can
-- pitch in when the other is out. The person's top bar gets the Showing switch for those people (dashboard, Review queue,
-- tasks, orders). Personal mail and Accounting stay private: mailbox and accounting rules are unchanged, and a task tied
-- to a private email stays with its owner.

alter table public.profiles add column if not exists can_see uuid[] not null default '{}';
comment on column public.profiles.can_see is 'People whose work this person can see and pick up (Dana sets it in Settings › Users).';

-- Only the admin changes what a person sees or may do. Also covers can_dnr, handles_logistics and note_initials, which
-- were added after the last version of this check. Can see keeps only other active people in the same organization.
create or replace function public.protect_profile_privileged_columns()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  if new.organization_id is distinct from old.organization_id then
    raise exception 'A profile cannot be moved to another organization' using errcode = '42501';
  end if;
  if new.can_see is distinct from old.can_see then
    new.can_see := coalesce(array(select distinct x from unnest(new.can_see) x
      where x <> new.id and exists (select 1 from public.profiles p where p.id = x and p.organization_id = new.organization_id)), '{}');
  end if;
  if auth.uid() is null then
    return new;
  end if;
  if not public.is_admin() then
    if new.role      is distinct from old.role
    or new.is_active is distinct from old.is_active
    or new.email     is distinct from old.email
    or new.places_orders is distinct from old.places_orders
    or new.sees_freight is distinct from old.sees_freight
    or new.sees_accounting is distinct from old.sees_accounting
    or new.enters_counts is distinct from old.enters_counts
    or new.sends_counts is distinct from old.sends_counts
    or new.can_see is distinct from old.can_see
    or new.can_dnr is distinct from old.can_dnr
    or new.handles_logistics is distinct from old.handles_logistics
    or new.note_initials is distinct from old.note_initials then
      raise exception 'Only administrators can change role, active status, email or what a person sees' using errcode = '42501';
    end if;
  elsif new.id = auth.uid()
    and (new.role is distinct from old.role or new.is_active is distinct from old.is_active) then
    raise exception 'Administrators cannot change their own role or deactivate themselves' using errcode = '42501';
  end if;
  return new;
end;
$$;

-- True when the signed-in person may see p_person's work.
create or replace function public.can_see_person(p_person uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select p_person is not null and exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_active and p_person = any(p.can_see))
$$;
revoke execute on function public.can_see_person(uuid) from public, anon;
grant execute on function public.can_see_person(uuid) to authenticated, service_role;

-- Tasks: also those of people you can see, except Accounting and tasks tied to mail you cannot open.
drop policy if exists "tasks: mine, given or admin" on public.tasks;
create policy "tasks: mine, given or admin" on public.tasks for select to authenticated
  using (public.user_in_org(organization_id)
         and (assigned_to = auth.uid() or created_by = auth.uid() or public.is_admin()
              or ((public.can_see_person(assigned_to) or public.can_see_person(created_by))
                  and (thread_id is null or exists (select 1 from public.email_threads th where th.id = tasks.thread_id))))
         and (area <> 'accounting' or public.sees_accounting()));
drop policy if exists "tasks: mine, given or admin change" on public.tasks;
create policy "tasks: mine, given or admin change" on public.tasks for update to authenticated
  using (public.user_in_org(organization_id)
         and (assigned_to = auth.uid() or created_by = auth.uid() or public.is_admin()
              or (public.can_see_person(assigned_to)
                  and (thread_id is null or exists (select 1 from public.email_threads th where th.id = tasks.thread_id))))
         and (area <> 'accounting' or public.sees_accounting()))
  with check (public.user_in_org(organization_id) and (area <> 'accounting' or public.sees_accounting()));

-- Finishing a task of someone you can see works too.
create or replace function public.complete_task(p_task uuid, p_note text default null)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  t public.tasks%rowtype;
  next_due date;
  next_id uuid;
begin
  select * into t from public.tasks where id = p_task for update;
  if t.id is null or not public.user_in_org(t.organization_id) or not (t.assigned_to = auth.uid() or t.created_by = auth.uid() or public.is_admin() or public.can_see_person(t.assigned_to))
     or (t.area = 'accounting' and not public.sees_accounting()) then
    raise exception 'Task not found' using errcode = '23503';
  end if;
  if t.done_at is not null then return null; end if;
  update public.tasks set done_at = now(), done_by = auth.uid(), done_note = nullif(trim(p_note), ''),
    done_notified_at = case when t.created_by is null or t.created_by = auth.uid() then now() end,
    done_seen_at = case when t.created_by is null or t.created_by = auth.uid() then now() end
  where id = p_task;
  if t.repeat_every is not null then
    next_due := public.task_next_due(t.due_date, t.repeat_every, t.repeat_unit, t.repeat_days);
    while next_due < current_date loop
      next_due := public.task_next_due(next_due, t.repeat_every, t.repeat_unit, t.repeat_days);
    end loop;
    if t.repeat_until is null or next_due <= t.repeat_until then
      insert into public.tasks (organization_id, title, notes, due_date, remind_at, assigned_to, created_by, vendor_id, carrier_id, order_id,
        thread_id, rep_group_id, tag_other, repeat_every, repeat_unit, repeat_days, repeat_until, repeat_of, area, procedure_id, policy_id, recipient_id, contract_id)
      values (t.organization_id, t.title, t.notes, next_due,
        case when t.remind_at is not null then t.remind_at + (next_due - t.due_date) * interval '1 day' end,
        t.assigned_to, t.created_by, t.vendor_id, t.carrier_id, t.order_id, t.thread_id, t.rep_group_id, t.tag_other,
        t.repeat_every, t.repeat_unit, t.repeat_days, t.repeat_until, t.id, t.area, t.procedure_id, t.policy_id, t.recipient_id, t.contract_id)
      returning id into next_id;
      update public.tasks set created_by = t.created_by where id = next_id;
    end if;
  end if;
  return next_id;
end;
$$;


-- Trevor and Jarrett see each other.
update public.profiles a set can_see = array[b.id]
from public.profiles b
where a.organization_id = b.organization_id and a.is_active and b.is_active
  and ((a.full_name ilike 'Trevor%' and b.full_name ilike 'Jarrett%') or (a.full_name ilike 'Jarrett%' and b.full_name ilike 'Trevor%'))
  and a.can_see = '{}';
