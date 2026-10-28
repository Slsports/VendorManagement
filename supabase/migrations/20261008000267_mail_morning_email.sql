-- 0267 — Morning mail email (Dana, Oct 28): "One email each morning, go." Each person who has orders@ mail waiting on
-- them gets one message a morning listing it, one click to each conversation. It goes the way they take reminders
-- (Dana: "All reminders go to our personal emails unless they have selected text instead of email"): an email to their
-- own address, and/or a short text with the count. Waiting = the dashboard's "Mail for you": replies waiting on them
-- (Needs an answer) and their sent mail with no answer past its follow-up date (No answer yet), orders@ and shared
-- conversations only, not snoozed. Sent from 8 AM Pacific (later if their texting hours start later), once a day.

set local lock_timeout = '5s';

alter table public.profiles add column if not exists mail_morning_on date;
comment on column public.profiles.mail_morning_on is 'The day the morning mail email last went to this person (Dana, Oct 28).';

-- The orders@ mail waiting on one person, oldest wait first.
create or replace function public.mail_morning_list(p_person uuid)
returns table (thread_id uuid, kind text, vendor_name text, subject text, since timestamptz)
language sql stable security definer set search_path = public as $$
  select t.id,
         case when t.status = 'waiting_on_us' then 'needs' else 'no_answer' end,
         v.name, t.subject,
         case when t.status = 'waiting_on_us' then coalesce(t.last_in_at, t.last_message_at) else coalesce(t.last_out_at, t.follow_up_at) end
    from public.email_threads t
    join public.profiles p on p.id = p_person and p.organization_id = t.organization_id
    left join public.vendors v on v.id = t.vendor_id
   where t.owner_id = p_person and t.deleted_at is null and (t.mailbox_id is null or t.shared_at is not null) and t.view = 'attention'
     and (t.status = 'waiting_on_us' or (t.status = 'waiting_on_vendor' and t.follow_up_at < now()))
     and not exists (select 1 from public.snoozes s where s.profile_id = p_person and s.thread_id = t.id and s.until > now())
   order by 2, 5 asc nulls last
$$;

-- The people due their morning email now (claimed: each is marked for today as it is handed out, so it goes once).
create or replace function public.mail_morning_due()
returns table (profile_id uuid, organization_id uuid, waiting integer)
language plpgsql security definer set search_path = public as $$
declare
  today date := (now() at time zone 'America/Los_Angeles')::date;
  at    time := (now() at time zone 'America/Los_Angeles')::time;
begin
  return query
  with due as (
    update public.profiles p set mail_morning_on = today
     where p.mail_morning_on is distinct from today
       and (p.remind_email or p.remind_text)
       and at >= greatest(time '08:00', case when p.remind_text then coalesce(p.text_from, time '08:00') else time '08:00' end)
       and exists (select 1 from public.email_threads t where t.owner_id = p.id)
    returning p.id, p.organization_id
  )
  select d.id, d.organization_id, (select count(*)::integer from public.mail_morning_list(d.id)) from due d;
end;
$$;

revoke execute on function public.mail_morning_list(uuid), public.mail_morning_due() from public, anon, authenticated;
grant execute on function public.mail_morning_list(uuid), public.mail_morning_due() to service_role;

-- the first one goes tomorrow morning, not this afternoon
update public.profiles set mail_morning_on = (now() at time zone 'America/Los_Angeles')::date;
