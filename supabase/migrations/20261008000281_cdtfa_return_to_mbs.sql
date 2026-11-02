-- 0281 — The CDTFA quarterly return goes to Nawal at MBS the day after it is filed (Dana, Nov 2): "When I file our cdtfa
-- quarterly return, the following day I need to email the copy of the return to Nawal at MBS. Please set a task reminder
-- the day after the return and pmt confirmation comes in and create a draft email to nawal and I can send it off to her. I
-- have to login to cdtfa the next day and download the return, it is not instantly available."
--   • When the quarter's CDTFA task closes on both confirmations (Filing and Payment), VMS makes a draft to Nawal from
--     billing@ in Dana's usual words ("Q3 2026 Sales Tax Return" / "Here is the 3rd quarter sales tax return") and a task
--     the next day at 9 AM that opens it: download the return from CDTFA, attach it, send.
--   • Sending an email to Nawal about the sales tax return closes the task.
--   • Back-check: Q3 2026 (filed and paid Oct 23) has no email to Nawal in billing@, so its task is made now.
set local lock_timeout = '5s';

create or replace function public.cdtfa_return_to_mbs(p_task uuid) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  t public.tasks%rowtype; v_end date; v_q integer; v_y integer; v_key text; v_owner uuid; v_box uuid; v_draft uuid; v_task uuid;
  v_filed date; v_due date; v_ord text; v_label text;
begin
  select * into t from public.tasks where id = p_task;
  if t.id is null or t.auto_key not like 'cdtfa:%' or t.title not like '%return%' or t.done_at is null
     or not (t.cdtfa_seen ? 'filing' and t.cdtfa_seen ? 'payment') then return null; end if;
  v_end := (t.cdtfa_seen->>'period_end')::date;
  if v_end is null then return null; end if;
  v_q := extract(quarter from v_end)::int;
  v_y := extract(year from v_end)::int;
  v_key := 'cdtfa_mbs:' || v_y || '-Q' || v_q;
  if exists (select 1 from public.tasks where organization_id = t.organization_id and auto_key = v_key) then return null; end if;
  v_owner := public.accounting_owner(t.organization_id);
  select id into v_box from public.mailboxes where organization_id = t.organization_id and kind = 'accounting' and is_active order by created_at limit 1;
  if v_owner is null or v_box is null then return null; end if;
  v_filed := (t.done_at at time zone 'America/Los_Angeles')::date;
  v_due := greatest(v_filed + 1, (now() at time zone 'America/Los_Angeles')::date);
  v_ord := case v_q when 1 then '1st' when 2 then '2nd' when 3 then '3rd' else '4th' end;
  v_label := 'Q' || v_q || ' ' || v_y;
  insert into public.email_drafts (organization_id, owner_id, created_by, to_emails, cc_emails, subject, body, mailbox_id, note)
  values (t.organization_id, v_owner, v_owner, array['nawal@mbsaccountancy.com'], '{}', v_label || ' Sales Tax Return',
          'Hi Nawal,' || E'\n\n' || 'Here is the ' || v_ord || ' quarter ' || v_y || ' sales tax return.' || E'\n\n' || 'Thanks! :-)',
          v_box, 'Attach the completed ' || v_label || ' return from CDTFA (it can be downloaded the day after filing), then send. VMS made this draft when CDTFA confirmed the filing and payment.')
  returning id into v_draft;
  insert into public.tasks (organization_id, title, notes, due_date, remind_at, assigned_to, created_by, auto_key, area, draft_id)
  values (t.organization_id, 'Send the ' || v_label || ' sales tax return to Nawal (MBS)',
          'CDTFA confirmed the ' || v_label || ' filing (' || coalesce(t.cdtfa_seen->>'filing_no', '?') || ') and payment (' || coalesce(t.cdtfa_seen->>'payment_no', '?') || ') on '
            || to_char(v_filed, 'Mon FMDD') || '. Log in to CDTFA, download the completed return, attach it to the email and send. Click to open the email.',
          v_due, greatest(now(), (v_due::timestamp + time '09:00') at time zone 'America/Los_Angeles'), v_owner, null, v_key, 'accounting', v_draft)
  returning id into v_task;
  return v_task;
end;
$$;
revoke execute on function public.cdtfa_return_to_mbs(uuid) from public, anon, authenticated;
grant execute on function public.cdtfa_return_to_mbs(uuid) to service_role;

-- The quarter's task closing on both confirmations makes the reminder and the draft.
create or replace function public.tasks_cdtfa_return_to_mbs() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.auto_key like 'cdtfa:%' and new.done_at is not null and old.done_at is null then
    perform public.cdtfa_return_to_mbs(new.id);
  end if;
  return null;
end;
$$;
drop trigger if exists tasks_cdtfa_return_to_mbs on public.tasks;
create trigger tasks_cdtfa_return_to_mbs after update of done_at on public.tasks
  for each row execute function public.tasks_cdtfa_return_to_mbs();

-- Sending it closes the task (and the draft is gone once sent).
create or replace function public.emails_cdtfa_return_sent() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.direction = 'out' and coalesce(new.subject, '') ~* 'sales tax return'
     and exists (select 1 from unnest(coalesce(new.to_emails, '{}'::text[])) a where lower(a) = 'nawal@mbsaccountancy.com') then
    update public.tasks set done_at = now(), closed_how = 'vms',
           done_note = 'The return went to Nawal on ' || to_char(coalesce(new.received_at, now()) at time zone 'America/Los_Angeles', 'Mon FMDD') || ' ("' || coalesce(new.subject, '') || '").'
     where organization_id = new.organization_id and auto_key like 'cdtfa_mbs:%' and done_at is null and created_at < coalesce(new.received_at, now()) + interval '1 minute';
  end if;
  return null;
end;
$$;
drop trigger if exists emails_cdtfa_return_sent on public.emails;
create trigger emails_cdtfa_return_sent after insert on public.emails for each row execute function public.emails_cdtfa_return_sent();

-- Back-check: quarter returns filed in the last 45 days with no email to Nawal since.
select public.cdtfa_return_to_mbs(t.id)
  from public.tasks t
 where t.auto_key like 'cdtfa:%' and t.title like '%return%' and t.done_at > now() - interval '45 days'
   and not exists (select 1 from public.emails e where e.organization_id = t.organization_id and e.direction = 'out' and e.received_at > t.done_at
                    and coalesce(e.subject, '') ~* 'sales tax return'
                    and exists (select 1 from unnest(coalesce(e.to_emails, '{}'::text[])) a where lower(a) = 'nawal@mbsaccountancy.com'));
