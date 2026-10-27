-- 0252 — Paperwork asked of Dana, and the CDTFA sales tax rhythm (Dana, Oct 27).
-- • An email that asks us to fill out, sign or return something becomes a task at once (task_from_ask), reminded now,
--   then every week, 3 days before its deadline and on the day (task_next_remind, remind_rule 'ask'); it closes itself
--   when a reply with attachments goes out on that conversation.
-- • CDTFA: prepayments for months 1 and 2 of a quarter are due the 24th of the following month; month 3's payment and
--   the quarterly return are due the end of the following month (Dana: "I file online so the day doesn't matter").
--   cdtfa_make_tasks makes the month's task on the 1st (weekly reminders, then 3 days before, then on the day);
--   CDTFA's own "Payment Confirmation" and "Filing Confirmation" emails to billing@ close them: a prepayment task on
--   its payment, the quarter task only on both the payment and the filing.
alter table public.tasks add column if not exists remind_rule text check (remind_rule in ('ask', 'cdtfa'));
alter table public.tasks add column if not exists cdtfa_seen jsonb not null default '{}'::jsonb;
comment on column public.tasks.remind_rule is 'ask / cdtfa: after each reminder the next one is set by task_next_remind (weekly, 3 days before, on the day).';

-- The next reminder after one went out: a week on, or 3 days before the due date, or the due date, whichever comes first (9 am Pacific).
create or replace function public.task_next_remind(p_due date, p_from timestamptz)
returns timestamptz language sql immutable as $$
  select min(t) from (
    select p_from + interval '7 days' as t
    union all select ((p_due - 3)::timestamp + time '09:00') at time zone 'America/Los_Angeles' where p_due is not null
    union all select (p_due::timestamp + time '09:00') at time zone 'America/Los_Angeles' where p_due is not null
  ) c where t > p_from + interval '1 hour'
$$;
grant execute on function public.task_next_remind(date, timestamptz) to authenticated, service_role;

-- A task for paperwork an email asks us for. Once per email.
create or replace function public.task_from_ask(p_email uuid, p_what text, p_deadline date)
returns uuid language plpgsql security definer set search_path = public as $$
declare e record; v_area text := 'general'; v_who uuid; v_task uuid; v_title text;
begin
  select m.id as email_id, m.organization_id, m.thread_id, m.mailbox_id, m.from_name, m.from_email, b.kind as box_kind, b.owner_id as box_owner, t.owner_id as thread_owner
    into e from public.emails m left join public.mailboxes b on b.id = m.mailbox_id left join public.email_threads t on t.id = m.thread_id where m.id = p_email;
  if e.email_id is null then return null; end if;
  select id into v_task from public.tasks where organization_id = e.organization_id and auto_key = 'ask:' || p_email;
  if v_task is not null then return v_task; end if;
  if e.box_kind = 'accounting' then v_area := 'accounting'; end if;
  v_who := coalesce(e.box_owner, e.thread_owner, public.org_admin(e.organization_id));
  if v_who is null then return null; end if;
  v_title := left('Paperwork for ' || coalesce(nullif(e.from_name, ''), e.from_email, 'them') || ': ' || coalesce(nullif(trim(p_what), ''), 'what they asked for'), 200);
  insert into public.tasks (organization_id, title, notes, due_date, remind_at, remind_rule, assigned_to, created_by, thread_id, auto_key, area)
    values (e.organization_id, v_title,
            case when p_deadline is not null then 'They asked for it by ' || to_char(p_deadline, 'Mon FMDD, YYYY') || '. VMS reminds you weekly, 3 days before, and on the day, until a reply with attachments goes out or you mark it done.'
                 else 'No date given. VMS reminds you weekly until a reply with attachments goes out or you mark it done.' end,
            p_deadline, now(), 'ask', v_who, v_who, e.thread_id, 'ask:' || p_email, v_area)
    returning id into v_task;
  return v_task;
end $$;
revoke execute on function public.task_from_ask(uuid, text, date) from public, anon;
grant execute on function public.task_from_ask(uuid, text, date) to service_role;

-- A reply with attachments on the conversation closes the paperwork task.
create or replace function public.emails_close_asks() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.direction = 'out' and coalesce(new.has_attachments, false) and new.thread_id is not null then
    update public.tasks set done_at = now(), closed_how = 'vms', done_note = 'A reply with attachments went out on ' || to_char(coalesce(new.received_at, now()) at time zone 'America/Los_Angeles', 'Mon FMDD') || ' (VMS saw it).'
      where thread_id = new.thread_id and done_at is null and auto_key like 'ask:%';
  end if;
  return null;
end $$;
drop trigger if exists emails_close_asks on public.emails;
create trigger emails_close_asks after insert on public.emails for each row execute function public.emails_close_asks();

-- The month's CDTFA task: the 1st of each month makes the one due that month (prepayment on the 24th, or the quarter's return and payment on the last day).
create or replace function public.cdtfa_make_tasks(p_org uuid, p_today date default current_date)
returns uuid language plpgsql security definer set search_path = public as $$
declare m date := date_trunc('month', p_today)::date; prev date; qi integer; qn integer; v_due date; v_title text; v_notes text; v_key text; v_task uuid; v_who uuid;
begin
  prev := (m - interval '1 month')::date;
  qi := ((extract(month from prev)::integer - 1) % 3) + 1;
  qn := ceil(extract(month from prev) / 3.0)::integer;
  v_key := 'cdtfa:' || to_char(m, 'YYYY-MM');
  select id into v_task from public.tasks where organization_id = p_org and auto_key = v_key;
  if v_task is not null then return v_task; end if;
  v_who := public.org_admin(p_org);
  if v_who is null then return null; end if;
  if qi in (1, 2) then
    v_due := m + 23;
    v_title := 'CDTFA prepayment for ' || to_char(prev, 'Month YYYY');
    v_notes := 'Sales tax prepayment for ' || trim(to_char(prev, 'Month YYYY')) || ' (month ' || qi || ' of Q' || qn || '), due by ' || to_char(v_due, 'Mon FMDD') || '. VMS closes this when CDTFA''s Payment Confirmation email arrives in billing@ this month.';
  else
    v_due := (m + interval '1 month' - interval '1 day')::date;
    v_title := 'CDTFA Q' || qn || ' ' || extract(year from prev) || ' sales tax return and payment';
    v_notes := 'File the Q' || qn || ' return and pay month 3 (' || trim(to_char(prev, 'Month')) || ') by ' || to_char(v_due, 'Mon FMDD') || '. VMS closes this only when both CDTFA emails arrive in billing@: the Filing Confirmation for the period ending ' || to_char(prev + interval '1 month' - interval '1 day', 'Mon FMDD') || ' and the Payment Confirmation.';
  end if;
  v_title := regexp_replace(v_title, '\s+', ' ', 'g');
  insert into public.tasks (organization_id, title, notes, due_date, remind_at, remind_rule, assigned_to, created_by, auto_key, area)
    values (p_org, v_title, v_notes, v_due, now(), 'cdtfa', v_who, v_who, v_key, 'accounting') returning id into v_task;
  return v_task;
end $$;
revoke execute on function public.cdtfa_make_tasks(uuid, date) from public, anon;
grant execute on function public.cdtfa_make_tasks(uuid, date) to service_role;

-- CDTFA's confirmation emails close the tasks. Payment Confirmation: "submitted on 10/23/2026" → the task due that month.
-- Filing Confirmation: "filing period 30-Sep-2026" → the quarter task due the following month; done only with its payment too.
create or replace function public.cdtfa_apply_email(p_email uuid)
returns text language plpgsql security definer set search_path = public as $$
declare e record; v_date date; v_key text; v_task record; v_no text; v_seen jsonb; v_done boolean := false;
begin
  select id, organization_id, from_email, subject, body_text, received_at into e from public.emails where id = p_email;
  if e.id is null or lower(coalesce(e.from_email, '')) <> 'noreply@cdtfa.ca.gov' then return null; end if;
  if e.subject ilike 'Payment Confirmation%' then
    v_date := to_date(substring(e.body_text from 'submitted on (\d{1,2}/\d{1,2}/\d{4})'), 'MM/DD/YYYY');
    if v_date is null then v_date := (e.received_at at time zone 'America/Los_Angeles')::date; end if;
    v_no := substring(e.body_text from 'confirmation number is:? ?([0-9-]+)');
    v_key := 'cdtfa:' || to_char(v_date, 'YYYY-MM');
    select * into v_task from public.tasks where organization_id = e.organization_id and auto_key = v_key;
    if v_task.id is null then return 'no task ' || v_key; end if;
    v_seen := v_task.cdtfa_seen || jsonb_build_object('payment', e.id, 'payment_no', v_no, 'payment_on', v_date);
    v_done := v_task.title like 'CDTFA prepayment%' or v_seen ? 'filing';
  elsif e.subject ilike 'Filing Confirmation%' then
    v_date := to_date(substring(e.body_text from 'filing period (\d{2}-[A-Za-z]{3}-\d{4})'), 'DD-Mon-YYYY');
    if v_date is null then return 'no period'; end if;
    v_no := substring(e.body_text from 'confirmation number is:? ?([0-9-]+)');
    v_key := 'cdtfa:' || to_char(v_date + interval '1 month', 'YYYY-MM');
    select * into v_task from public.tasks where organization_id = e.organization_id and auto_key = v_key;
    if v_task.id is null then return 'no task ' || v_key; end if;
    v_seen := v_task.cdtfa_seen || jsonb_build_object('filing', e.id, 'filing_no', v_no, 'period_end', v_date);
    v_done := v_seen ? 'payment';
  else
    return null;
  end if;
  update public.tasks set cdtfa_seen = v_seen,
    done_at = case when v_done and done_at is null then now() else done_at end,
    closed_how = case when v_done and done_at is null then 'vms' else closed_how end,
    done_note = case when v_done and done_at is null then 'CDTFA confirmed it in billing@: ' || concat_ws(', ', case when v_seen ? 'payment_no' then 'payment ' || (v_seen->>'payment_no') || ' on ' || (v_seen->>'payment_on') end, case when v_seen ? 'filing_no' then 'filing ' || (v_seen->>'filing_no') || ' for the period ending ' || (v_seen->>'period_end') end) else done_note end
    where id = v_task.id;
  return case when v_done then 'done ' || v_key else 'seen ' || v_key end;
end $$;
revoke execute on function public.cdtfa_apply_email(uuid) from public, anon;
grant execute on function public.cdtfa_apply_email(uuid) to service_role;

create or replace function public.emails_cdtfa() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if lower(coalesce(new.from_email, '')) = 'noreply@cdtfa.ca.gov' then perform public.cdtfa_apply_email(new.id); end if;
  return null;
end $$;
drop trigger if exists emails_cdtfa on public.emails;
create trigger emails_cdtfa after insert on public.emails for each row execute function public.emails_cdtfa();

-- Every day: the month's CDTFA task (idempotent), for every organization.
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule(jobid) from cron.job where jobname = 'cdtfa-tasks';
    perform cron.schedule('cdtfa-tasks', '5 15 * * *', $job$select public.cdtfa_make_tasks(id) from public.organizations$job$);
  end if;
end $$;

-- Now: this month's task for every organization, and CDTFA's confirmations already on file applied to it.
select public.cdtfa_make_tasks(id) from public.organizations;
select public.cdtfa_apply_email(id) from public.emails where lower(coalesce(from_email, '')) = 'noreply@cdtfa.ca.gov' and received_at > now() - interval '120 days' order by received_at;
