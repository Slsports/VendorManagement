-- Administrative paperwork goes to Dana (Nov 9): "I handle all administrative tasks with vendors like sending our resale #,
-- filling out credit apps, etc." A paperwork ask that is administrative (credit application, W-9, resale or tax-exemption
-- certificate, new customer / dealer account form, agreement or contract, insurance, license, registration) is Dana's task
-- whichever mailbox it came into; order paperwork a buyer answers stays with the mailbox owner. Claude says which when it
-- reads the ask; the open ones already made are checked again (gmail-sync back-check) and moved.
-- Also: handing a conversation in someone's own mailbox to another person silently snapped back to the mailbox owner
-- (trigger from Oct 11). Now a conversation shared to Orders can be handed over (it stays in that mailbox), and an unshared
-- one says so instead of pretending.

alter table public.tasks add column if not exists ask_admin boolean;   -- null: not judged yet (the back-check does it)
comment on column public.tasks.ask_admin is 'For paperwork asks: true when the paperwork is administrative (Dana''s), false when it is the mailbox owner''s; null until judged.';

create or replace function public.task_from_ask(p_email uuid, p_what text, p_deadline date, p_admin boolean default false)
returns uuid language plpgsql security definer set search_path = public as $$
declare e record; v_area text := 'general'; v_who uuid; v_task uuid; v_title text;
begin
  select m.id as email_id, m.organization_id, m.thread_id, m.mailbox_id, m.from_name, m.from_email, b.kind as box_kind, b.owner_id as box_owner, t.owner_id as thread_owner
    into e from public.emails m left join public.mailboxes b on b.id = m.mailbox_id left join public.email_threads t on t.id = m.thread_id where m.id = p_email;
  if e.email_id is null then return null; end if;
  select id into v_task from public.tasks where organization_id = e.organization_id and auto_key = 'ask:' || p_email;
  if v_task is not null then return v_task; end if;
  if e.box_kind = 'accounting' then v_area := 'accounting'; end if;
  -- administrative paperwork is Dana's (Nov 9); the rest belongs to whoever the email came to
  v_who := case when coalesce(p_admin, false) then public.org_admin(e.organization_id) end;
  v_who := coalesce(v_who, e.box_owner, e.thread_owner, public.org_admin(e.organization_id));
  if v_who is null then return null; end if;
  v_title := left('Paperwork for ' || coalesce(nullif(e.from_name, ''), e.from_email, 'them') || ': ' || coalesce(nullif(trim(p_what), ''), 'what they asked for'), 200);
  insert into public.tasks (organization_id, title, notes, due_date, remind_at, remind_rule, assigned_to, created_by, thread_id, auto_key, area, ask_admin)
    values (e.organization_id, v_title,
            case when p_deadline is not null then 'They asked for it by ' || to_char(p_deadline, 'Mon FMDD, YYYY') || '. VMS reminds you weekly, 3 days before, and on the day, until a reply with attachments goes out or you mark it done.'
                 else 'No date given. VMS reminds you weekly until a reply with attachments goes out or you mark it done.' end
            || case when coalesce(p_admin, false) then ' Administrative paperwork, so it is Dana''s.' else '' end,
            p_deadline, now(), 'ask', v_who, v_who, e.thread_id, 'ask:' || p_email, v_area, coalesce(p_admin, false))
    returning id into v_task;
  return v_task;
end $$;
revoke execute on function public.task_from_ask(uuid, text, date, boolean) from public, anon;
grant execute on function public.task_from_ask(uuid, text, date, boolean) to service_role;
drop function if exists public.task_from_ask(uuid, text, date);

-- The back-check's verdict on a paperwork task already made: administrative ones move to Dana.
create or replace function public.ask_task_route(p_task uuid, p_admin boolean) returns boolean
language plpgsql security definer set search_path = public as $$
declare t public.tasks%rowtype; v_admin uuid; v_from text;
begin
  select * into t from public.tasks where id = p_task and auto_key like 'ask:%';
  if t.id is null then return false; end if;
  update public.tasks set ask_admin = p_admin where id = p_task;
  if not p_admin or t.done_at is not null then return false; end if;
  v_admin := public.org_admin(t.organization_id);
  if v_admin is null or t.assigned_to = v_admin then return false; end if;
  select full_name into v_from from public.profiles where id = t.assigned_to;
  update public.tasks set assigned_to = v_admin, reminded_at = null, reminder_seen_at = null, remind_at = now(),
         notes = coalesce(notes, '') || ' Moved from ' || coalesce(v_from, 'the mailbox owner') || ' to Dana on ' || to_char(now() at time zone 'America/Los_Angeles', 'Mon FMDD') || ': administrative paperwork is hers (credit applications, W-9, resale certificate, account forms, agreements).'
   where id = p_task;
  return true;
end $$;
revoke execute on function public.ask_task_route(uuid, boolean) from public, anon, authenticated;
grant execute on function public.ask_task_route(uuid, boolean) to service_role;

-- ---- handing over a conversation that lives in someone's mailbox ------------------------------------------------
-- The mailbox owner owns a new conversation and any still private; one shared to Orders can be handed to someone else.
create or replace function public.email_threads_mailbox_owner() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.mailbox_id is not null and (tg_op = 'INSERT' or new.mailbox_id is distinct from old.mailbox_id or new.shared_at is null) then
    new.owner_id := (select owner_id from public.mailboxes where id = new.mailbox_id);
  end if;
  return new;
end;
$$;

create or replace function public.assign_email_thread(p_thread uuid, p_profile uuid default null)
returns void language plpgsql security definer set search_path = public as $$
declare t public.email_threads%rowtype; v_owner text;
begin
  if not public.user_can_edit() then raise exception 'Only admins, managers and buyers assign mail'; end if;
  select * into t from public.email_threads where id = p_thread for update;
  if not found or not public.user_in_org(t.organization_id) then raise exception 'Thread not found'; end if;
  if p_profile is not null and not exists (select 1 from public.profiles p where p.id = p_profile and p.organization_id = t.organization_id and p.is_active) then
    raise exception 'That person is not an active user here';
  end if;
  if t.mailbox_id is not null and t.shared_at is null and p_profile is distinct from t.owner_id then
    select p.full_name into v_owner from public.mailboxes b join public.profiles p on p.id = b.owner_id where b.id = t.mailbox_id;
    raise exception 'This conversation is in %''s own mailbox, so it stays theirs. Share it to Orders first, then hand it over.', coalesce(v_owner, 'the mailbox owner') using errcode = '22023';
  end if;
  update public.email_threads set owner_id = p_profile, owner_set_at = now() where id = p_thread;
end;
$$;
