-- 0279 — Personal insurance, the bank's yearly proof through Myinsuranceinfo, Markel, and repeating autopay reminders
-- (Dana, Nov 2: "go, and yes remind me on personal autopays too").
--   • Personal insurance is its own place (Dana: "Goosehead Insurance is all our personal insurance, that should be in a
--     separate 'personal insurance' location. Those are tied to 35775 Aunt Julia Lane, 35771 Aunt Julia lane and the SJ&E
--     Road properties"; "bamboo & steadily are personal property insurance - same situation as the commercial property up
--     here. We have Cal FAir for fire and the other policies are considered a wrap/dic"; "Drive is Progressive and is
--     personal insurance for Tylers truck, Gregs truck and my toyota"). New category personal_insurance for contacts and
--     papers; policies get a personal tick and show on their own Personal tab.
--   • Community West Bank (was Central Valley Community Bank) needs proof of insurance for the commercial loan every year,
--     uploaded to myinsuranceinfo.com, the bank's tracking service ("Link them together"). A Myinsuranceinfo confirmation
--     email records the send and closes the task. Recipients with a fixed date now get a yearly task 30 days ahead.
--   • Markel (wave runner liability for the marina, on autopay) is added as a business policy.
--   • Repeating autopays get a reminder 5 days before the next one from their pattern (autopay_schedules): Drive (every 6
--     months), Markel and Hub (yearly), and the IRS and FTB estimates on the dates seen this year. When an email gives the
--     real date or amount, it updates that reminder instead of making a second one.
--   • Starlink, Midvalley Disposal and Keith Garcia (on Bill.com) never make autopay reminders (Dana, Nov 2).
set local lock_timeout = '5s';

-- Personal insurance category ------------------------------------------------------------------------------------------
alter table public.accounting_contacts drop constraint if exists accounting_contacts_category_check;
alter table public.accounting_contacts add constraint accounting_contacts_category_check
  check (category in ('taxes', 'insurance', 'personal_insurance', 'banking', 'payroll', 'donations', 'contracts', 'accounting_firm', 'bills', 'other'));
alter table public.accounting_documents drop constraint if exists accounting_documents_category_check;
alter table public.accounting_documents add constraint accounting_documents_category_check
  check (category in ('taxes', 'insurance', 'personal_insurance', 'banking', 'payroll', 'donations', 'contracts', 'accounting_firm', 'bills', 'other'));

alter table public.accounting_procedures drop constraint if exists accounting_procedures_category_check;
alter table public.accounting_procedures add constraint accounting_procedures_category_check
  check (category in ('taxes', 'insurance', 'personal_insurance', 'banking', 'payroll', 'donations', 'contracts', 'accounting_firm', 'bills', 'other'));

alter table public.accounting_policies add column if not exists personal boolean not null default false;
comment on column public.accounting_policies.personal is 'Personal insurance (Goosehead; the homes at 35775 and 35771 Aunt Julia Lane and SJ&E Road, the family vehicles), shown on its own tab (Dana, Nov 2).';

-- How a recipient takes the proof (an upload site instead of an email).
alter table public.accounting_policy_recipients add column if not exists send_how text not null default '';
comment on column public.accounting_policy_recipients.send_how is 'How they take it when it is not an email: "Upload it at myinsuranceinfo.com …" (Community West Bank).';

-- Send tasks say how to send.
create or replace function public.accounting_policy_received_core(p_policy uuid, p_term text, p_document uuid default null)
returns integer language plpgsql security definer set search_path = public as $$
declare pol public.accounting_policies%rowtype; r record; n integer := 0; v_owner uuid; v_proc uuid; v_key text;
begin
  select * into pol from public.accounting_policies where id = p_policy;
  if pol.id is null then raise exception 'Policy not found' using errcode = '23503'; end if;
  insert into public.accounting_policy_terms (organization_id, policy_id, term_label, received_at, document_id)
  values (pol.organization_id, p_policy, p_term, now(), p_document)
  on conflict (policy_id, term_label) do update set received_at = coalesce(accounting_policy_terms.received_at, now()),
    document_id = coalesce(excluded.document_id, accounting_policy_terms.document_id);
  v_owner := public.accounting_owner(pol.organization_id);
  select id into v_proc from public.accounting_procedures where organization_id = pol.organization_id and slug = 'send-proof-of-insurance';
  for r in select * from public.accounting_policy_recipients rc where rc.organization_id = pol.organization_id and rc.status = 'confirmed' and p_policy = any (rc.policy_ids) loop
    v_key := 'policy_send:' || r.id || ':' || p_policy || ':' || p_term;
    if exists (select 1 from public.tasks t where t.organization_id = pol.organization_id and t.auto_key = v_key) then continue; end if;
    if exists (select 1 from public.accounting_policy_sends s where s.recipient_id = r.id and s.policy_id = p_policy and s.term_label = p_term) then continue; end if;
    insert into public.tasks (organization_id, title, notes, due_date, remind_at, assigned_to, auto_key, area, procedure_id, policy_id, recipient_id)
    values (pol.organization_id, 'Send ' || p_term || ' ' || pol.label || ' to ' || coalesce(nullif(r.company, ''), r.person, r.email),
            'They need it ' || case when r.when_kind = 'renewal' then 'every renewal' else 'by ' || coalesce(r.due_month::text, '?') || '/' || coalesce(r.due_day::text, '?') end
            || case when r.why <> '' then ' (' || r.why || ')' else '' end || '. '
            || coalesce(nullif(r.send_how, ''), 'Send to ' || r.email || ' from billing@.'),
            current_date + 7, ((current_date + 7)::timestamp + time '09:00') at time zone 'America/Los_Angeles', v_owner, v_key, 'accounting', v_proc, p_policy, r.id);
    n := n + 1;
  end loop;
  return n;
end;
$$;

-- Renewal tasks, plus a yearly task for recipients who need proof by a fixed date (the bank, every November).
create or replace function public.accounting_sync_policy_tasks(p_org uuid default null)
returns integer language plpgsql security definer set search_path = public as $$
declare p record; r record; n integer := 0; v_owner uuid; v_proc uuid; v_key text; v_title text; v_notes text; v_due date;
begin
  if auth.uid() is not null and not public.sees_accounting() then raise exception 'Accounting only' using errcode = '42501'; end if;
  for p in
    select pol.* from public.accounting_policies pol
     where pol.is_active and pol.renewal_date is not null and (p_org is null or pol.organization_id = p_org)
       and pol.renewal_date <= current_date + 45
  loop
    v_owner := public.accounting_owner(p.organization_id);
    if v_owner is null then continue; end if;
    v_key := 'policy_renewal:' || p.id || ':' || p.renewal_date;
    if exists (select 1 from public.tasks t where t.organization_id = p.organization_id and t.auto_key = v_key) then continue; end if;
    select id into v_proc from public.accounting_procedures where organization_id = p.organization_id and slug = 'property-insurance-renewal';
    v_title := 'Renewal: ' || p.label || case when p.carrier <> '' then ' (' || p.carrier || ')' else '' end;
    v_notes := 'Renews ' || to_char(p.renewal_date, 'Mon DD, YYYY') || '. Policy # ' || coalesce(nullif(p.policy_number, ''), '?')
      || case when p.paid_by <> '' then '. Paid by ' || p.paid_by else '' end
      || case when p.autopay then '. On autopay: confirm it went through, do not pay twice' else '' end
      || case when p.billed_with <> '' then '. Billed with ' || p.billed_with else '' end || '.';
    insert into public.tasks (organization_id, title, notes, due_date, remind_at, assigned_to, created_by, auto_key, area, procedure_id, policy_id)
    values (p.organization_id, v_title, v_notes, p.renewal_date, ((p.renewal_date - 30)::timestamp + time '09:00') at time zone 'America/Los_Angeles',
            v_owner, null, v_key, 'accounting', v_proc, p.id);
    n := n + 1;
  end loop;

  for r in
    select rc.* from public.accounting_policy_recipients rc
     where rc.status = 'confirmed' and rc.when_kind = 'date' and rc.due_month is not null and (p_org is null or rc.organization_id = p_org)
  loop
    v_due := make_date(extract(year from current_date)::int, r.due_month, least(coalesce(r.due_day, 1), 28));
    if v_due < current_date - 60 then v_due := (v_due + interval '1 year')::date; end if;
    if v_due > current_date + 30 then continue; end if;
    -- sent for this year already (within 200 days before the date)
    if exists (select 1 from public.accounting_policy_sends s where s.recipient_id = r.id and s.sent_on > v_due - 200) then continue; end if;
    v_owner := public.accounting_owner(r.organization_id);
    if v_owner is null then continue; end if;
    v_key := 'proof_due:' || r.id || ':' || v_due;
    if exists (select 1 from public.tasks t where t.organization_id = r.organization_id and t.auto_key = v_key) then continue; end if;
    select id into v_proc from public.accounting_procedures where organization_id = r.organization_id and slug = 'send-proof-of-insurance';
    insert into public.tasks (organization_id, title, notes, due_date, remind_at, assigned_to, auto_key, area, procedure_id, recipient_id, thread_id)
    values (r.organization_id, left('Send proof of insurance to ' || coalesce(nullif(r.company, ''), r.person, r.email) || ' by ' || to_char(v_due, 'Mon FMDD'), 200),
            concat_ws(' ', nullif(r.why, '') || '.', coalesce(nullif(r.send_how, ''), 'Send to ' || r.email || ' from billing@.'),
                      (select 'Last sent ' || to_char(max(s.sent_on), 'Mon FMDD, YYYY') || '.' from public.accounting_policy_sends s where s.recipient_id = r.id)),
            v_due, greatest(now(), ((v_due - 30)::timestamp + time '09:00') at time zone 'America/Los_Angeles'), v_owner, v_key, 'accounting', v_proc, r.id,
            (select e.thread_id from public.accounting_policy_sends s join public.emails e on e.id = s.email_id where s.recipient_id = r.id order by s.sent_on desc limit 1));
    n := n + 1;
  end loop;
  return n;
end;
$$;

-- A Myinsuranceinfo confirmation is the bank's receipt: record the send and close the task.
create or replace function public.myinsuranceinfo_confirmation(p_email uuid) returns uuid
language plpgsql security definer set search_path = public as $$
declare e record; r public.accounting_policy_recipients%rowtype; v_file text; v_term text; v_yy text; v_id uuid;
begin
  select em.id, em.organization_id, em.received_at, em.body_text, em.subject, em.from_email into e
    from public.emails em join public.mailboxes b on b.id = em.mailbox_id and b.kind = 'accounting'
   where em.id = p_email and em.direction = 'in' and em.from_email ilike '%@myinsuranceinfo.com' and coalesce(em.subject, '') ~* 'confirmation';
  if e.id is null then return null; end if;
  select * into r from public.accounting_policy_recipients rc
   where rc.organization_id = e.organization_id and rc.status = 'confirmed' and rc.send_how ilike '%myinsuranceinfo%' order by rc.created_at limit 1;
  if r.id is null then return null; end if;
  if exists (select 1 from public.accounting_policy_sends s where s.email_id = e.id) then return null; end if;
  v_file := substring(coalesce(e.body_text, '') from 'attachment named "([^"]+)"');
  v_yy := substring(coalesce(v_file, '') from '(\d{2}-\d{2})');
  v_term := case when v_yy is not null then '20' || v_yy
                 else to_char(e.received_at at time zone 'America/Los_Angeles', 'YYYY') || '-' || to_char((e.received_at at time zone 'America/Los_Angeles') + interval '1 year', 'YY') end;
  insert into public.accounting_policy_sends (organization_id, recipient_id, term_label, sent_on, sent_by, email_id, note)
  values (e.organization_id, r.id, v_term, (e.received_at at time zone 'America/Los_Angeles')::date, 'us', e.id,
          'Uploaded to Myinsuranceinfo' || coalesce(': ' || v_file, ''))
  returning id into v_id;
  update public.accounting_policy_recipients
     set last_sent_on = greatest(coalesce(last_sent_on, '1900-01-01'), (e.received_at at time zone 'America/Los_Angeles')::date),
         last_sent_term = case when coalesce(last_sent_on, '1900-01-01') <= (e.received_at at time zone 'America/Los_Angeles')::date then v_term else last_sent_term end
   where id = r.id;
  update public.tasks set done_at = now(), closed_how = 'vms',
         done_note = 'Myinsuranceinfo confirmed the upload' || coalesce(' of "' || v_file || '"', '') || ' on ' || to_char(e.received_at at time zone 'America/Los_Angeles', 'Mon FMDD, YYYY') || '.'
   where organization_id = e.organization_id and recipient_id = r.id and done_at is null and (auto_key like 'proof_due:%' or auto_key like 'policy_send:%')
     and created_at < e.received_at + interval '1 day';
  return v_id;
end;
$$;
revoke execute on function public.myinsuranceinfo_confirmation(uuid) from public, anon, authenticated;
grant execute on function public.myinsuranceinfo_confirmation(uuid) to service_role;

create or replace function public.emails_myinsuranceinfo() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.direction = 'in' and new.mailbox_id is not null and new.from_email ilike '%@myinsuranceinfo.com' then
    perform public.myinsuranceinfo_confirmation(new.id);
  end if;
  return new;
end;
$$;
drop trigger if exists emails_myinsuranceinfo on public.emails;
create trigger emails_myinsuranceinfo after insert on public.emails for each row execute function public.emails_myinsuranceinfo();

-- Repeating autopays --------------------------------------------------------------------------------------------------
create table if not exists public.autopay_schedules (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations(id) on delete cascade,
  payee            text not null,
  what             text not null default '',
  payee_match      text not null,
  every_months     integer not null check (every_months between 1 and 24),
  next_on          date not null,
  amount           numeric(12, 2),
  automatic        boolean not null default true,
  personal         boolean not null default false,
  policy_id        uuid references public.accounting_policies(id) on delete set null,
  last_email_id    uuid references public.emails(id) on delete set null,
  is_active        boolean not null default true,
  note             text not null default '',
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
comment on table public.autopay_schedules is 'Autopays that repeat without an email each time (Dana, Nov 2): a reminder 5 days before the next one, from the pattern.';
drop trigger if exists autopay_schedules_updated_at on public.autopay_schedules;
create trigger autopay_schedules_updated_at before update on public.autopay_schedules for each row execute function public.set_updated_at();
alter table public.autopay_schedules enable row level security;
drop policy if exists "autopay_schedules: accounting people" on public.autopay_schedules;
create policy "autopay_schedules: accounting people" on public.autopay_schedules for all to authenticated
  using (public.user_in_org(organization_id) and public.sees_accounting())
  with check (public.user_in_org(organization_id) and public.sees_accounting());
grant select, insert, update, delete on table public.autopay_schedules to authenticated;
grant all on table public.autopay_schedules to service_role;

-- Payees that never get autopay reminders (Dana, Nov 2).
create or replace function public.autopay_skip_payee(p text) returns boolean
language sql immutable set search_path = '' as $$ select coalesce(p, '') ~* '(starlink|midvalley|mid valley|keith garcia)' $$;
grant execute on function public.autopay_skip_payee(text) to authenticated, service_role;

-- The reminder for each schedule's next date; past dates roll forward.
create or replace function public.autopay_schedule_tasks(p_org uuid default null) returns integer
language plpgsql security definer set search_path = public as $$
declare s record; n integer := 0; v_owner uuid; v_key text; v_next date; v_thread uuid; v_last text;
begin
  for s in select * from public.autopay_schedules a where a.is_active and (p_org is null or a.organization_id = p_org) loop
    v_next := s.next_on;
    while v_next < current_date - 2 loop
      v_next := (v_next + make_interval(months => s.every_months))::date;
    end loop;
    if v_next <> s.next_on then update public.autopay_schedules set next_on = v_next where id = s.id; end if;
    if v_next > current_date + 5 then continue; end if;
    -- an email already gave this one its own reminder
    if exists (select 1 from public.autopay_payments p where p.organization_id = s.organization_id and p.task_id is not null
                and p.payee ~* s.payee_match and abs(p.pay_on - v_next) <= 10) then continue; end if;
    v_key := 'autopay_sched:' || s.id || ':' || v_next;
    if exists (select 1 from public.tasks t where t.organization_id = s.organization_id and t.auto_key = v_key) then continue; end if;
    v_owner := public.accounting_owner(s.organization_id);
    if v_owner is null then continue; end if;
    select e.thread_id, to_char(e.received_at at time zone 'America/Los_Angeles', 'Mon FMDD, YYYY') into v_thread, v_last from public.emails e where e.id = s.last_email_id;
    insert into public.tasks (organization_id, title, notes, due_date, remind_at, assigned_to, auto_key, area, thread_id, policy_id)
    values (s.organization_id,
            left(case when s.automatic then 'Autopay ' else 'Pay by ' end || to_char(v_next, 'Mon FMDD') || ' (expected): ' || s.payee
                 || coalesce(' ~$' || to_char(s.amount, 'FM999,999,990.00'), '') || coalesce(' (' || nullif(s.what, '') || ')', ''), 200),
            concat_ws(' ',
              'Expected from the pattern (every ' || case when s.every_months = 12 then 'year' when s.every_months = 1 then 'month' else s.every_months || ' months' end || ').',
              case when s.amount is not null then 'Last time it was $' || to_char(s.amount, 'FM999,999,990.00') || '; the amount can change.' else 'The amount isn''t known yet.' end,
              case when s.automatic then 'Make sure the bank account covers it.' end,
              nullif(s.note, ''),
              case when v_last is not null then 'Click to open the last email about it (' || v_last || ').' end),
            v_next, greatest(now(), ((v_next - 5)::timestamp + time '09:00') at time zone 'America/Los_Angeles'), v_owner, v_key, 'accounting', v_thread, s.policy_id);
    n := n + 1;
  end loop;
  return n;
end;
$$;
revoke execute on function public.autopay_schedule_tasks(uuid) from public, anon, authenticated;
grant execute on function public.autopay_schedule_tasks(uuid) to service_role;

-- Email-read payments: skip Dana's three; an email for a repeating autopay updates that reminder instead of adding one.
create or replace function public.autopay_apply(p_email uuid, p_items jsonb, p_error text default null) returns integer
language plpgsql security definer set search_path = public as $$
declare
  e record; it jsonb; v_on date; v_amt numeric; v_payee text; v_what text; v_auto boolean; v_key text; v_id uuid; v_task uuid;
  v_owner uuid; n integer := 0; v_title text; v_notes text; v_remind timestamptz; sch record; v_sched_task uuid;
begin
  select id, organization_id, subject, received_at, thread_id into e from public.emails where id = p_email;
  if e.id is null then return 0; end if;
  update public.emails set autopay_read_at = now(), autopay_error = p_error where id = p_email;
  v_owner := public.accounting_owner(e.organization_id);
  for it in select * from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) loop
    v_on := case when it->>'date' ~ '^\d{4}-\d{2}-\d{2}$' then (it->>'date')::date end;
    v_payee := nullif(trim(it->>'payee'), '');
    if v_on is null or v_payee is null or v_payee ~* 'cdtfa' or public.autopay_skip_payee(v_payee) then continue; end if;
    v_amt := case when jsonb_typeof(it->'amount') = 'number' then round((it->>'amount')::numeric, 2) end;
    v_what := nullif(trim(it->>'what'), '');
    v_auto := coalesce((it->>'automatic')::boolean, true);
    v_key := lower(regexp_replace(v_payee, '[^A-Za-z0-9]', '', 'g')) || ':' || v_on || ':' || coalesce(v_amt::text, '');
    insert into public.autopay_payments (organization_id, email_id, payee, what, pay_on, amount, automatic, dedupe_key)
    values (e.organization_id, e.id, v_payee, v_what, v_on, v_amt, v_auto, v_key)
    on conflict (organization_id, dedupe_key) do update set automatic = autopay_payments.automatic or excluded.automatic
    returning id, task_id into v_id, v_task;

    -- a repeating autopay near this date: keep its amount and email current, and use its reminder
    v_sched_task := null;
    select * into sch from public.autopay_schedules a
     where a.organization_id = e.organization_id and a.is_active and v_payee ~* a.payee_match and abs(v_on - a.next_on) <= 10
     order by abs(v_on - a.next_on) limit 1;
    if sch.id is not null then
      update public.autopay_schedules set amount = coalesce(v_amt, amount), last_email_id = e.id where id = sch.id;
      select t.id into v_sched_task from public.tasks t
       where t.organization_id = e.organization_id and t.auto_key = 'autopay_sched:' || sch.id || ':' || sch.next_on and t.done_at is null;
    end if;

    if v_task is not null or v_on < (now() at time zone 'America/Los_Angeles')::date or v_owner is null then continue; end if;
    v_title := left(case when v_auto then 'Autopay ' || to_char(v_on, 'Mon FMDD') else 'Pay by ' || to_char(v_on, 'Mon FMDD') end || ': ' || v_payee
               || coalesce(' $' || to_char(v_amt, 'FM999,999,990.00'), '') || coalesce(' (' || v_what || ')', ''), 200);
    v_notes := concat_ws(' ',
              case when v_auto then 'Comes out automatically on ' || to_char(v_on, 'Mon FMDD, YYYY') || '. Make sure the bank account covers it.'
                   else 'Due ' || to_char(v_on, 'Mon FMDD, YYYY') || '.' end,
              'From "' || coalesce(e.subject, 'an email') || '" (' || to_char(e.received_at at time zone 'America/Los_Angeles', 'Mon FMDD, YYYY') || '). Click to open it.');
    v_remind := greatest(now(), ((v_on - 5)::timestamp + time '09:00') at time zone 'America/Los_Angeles');
    if v_sched_task is not null then
      update public.tasks set title = v_title, notes = v_notes, due_date = v_on, remind_at = v_remind, thread_id = e.thread_id, reminded_at = null
       where id = v_sched_task;
      update public.autopay_payments set task_id = v_sched_task where id = v_id;
      continue;
    end if;
    insert into public.tasks (organization_id, title, notes, due_date, remind_at, assigned_to, auto_key, area, thread_id, policy_id)
    values (e.organization_id, v_title, v_notes, v_on, v_remind, v_owner, 'autopay:' || v_id, 'accounting', e.thread_id, sch.policy_id)
    on conflict (organization_id, auto_key) where auto_key is not null do nothing
    returning id into v_task;
    if v_task is not null then
      update public.autopay_payments set task_id = v_task where id = v_id;
      n := n + 1;
    end if;
  end loop;
  return n;
end;
$$;
revoke execute on function public.autopay_apply(uuid, jsonb, text) from public, anon, authenticated;
grant execute on function public.autopay_apply(uuid, jsonb, text) to service_role;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule(jobid) from cron.job where jobname = 'autopay-schedules';
    perform cron.schedule('autopay-schedules', '20 13 * * *', 'select public.autopay_schedule_tasks()');
  end if;
end $$;

-- Data (hosted only: every step finds its rows by id, number or name) -------------------------------------------------

-- Contacts: personal insurers, the bank, and Myinsuranceinfo tied to the bank.
update public.accounting_contacts set category = 'personal_insurance', status = 'confirmed',
       role = case when company ~* 'goosehead' then 'Our personal insurance agent (homes and vehicles)' else role end,
       notes = case when company ~* 'goosehead' then 'Personal insurance: 35775 and 35771 Aunt Julia Lane, SJ&E Road, the family vehicles (Dana, Nov 2).'
                    when company ~* '(drive|progressive)' then 'Personal auto (Drive is Progressive): Tyler''s truck, Greg''s truck, Dana''s Toyota (Dana, Nov 2).'
                    when company ~* 'bamboo' then 'Personal home wrap / DIC (Dana, Nov 2).' else notes end
 where merged_into is null and company ~* '^(goosehead|driveinsurance|progressive|bambooinsurance|steadily)';
update public.accounting_contacts set category = 'insurance', status = 'confirmed', company = 'Markel',
       role = 'Wave runner liability for the marina (on autopay)'
 where merged_into is null and company = 'Markel Online Account';
update public.accounting_contacts set category = 'banking', status = 'confirmed',
       notes = case when notes = '' then 'Our bank; commercial loan (was Central Valley Community Bank).' else notes end
 where merged_into is null and company = 'Community West Bank';
update public.accounting_contacts set category = 'banking', status = 'confirmed', company = 'Myinsuranceinfo (Community West Bank)',
       notes = 'The service Community West Bank uses to track our insurance for the commercial loan. We or Hub upload the proof each year; their confirmation email marks it sent (Dana, Nov 2).'
 where merged_into is null and company = 'Myinsuranceinfo';

-- Community West Bank needs proof every year, uploaded to Myinsuranceinfo.
insert into public.accounting_policy_recipients (organization_id, company, person, email, contact_id, policy_ids, why, when_kind, due_month, due_day, status, send_how, notes)
select c.organization_id, 'Community West Bank', '', '', c.id,
       array(select p.id from public.accounting_policies p where p.organization_id = c.organization_id and p.coverage_type in ('liability', 'workers_comp') and not p.personal and p.is_active),
       'Commercial loan: proof of insurance every year', 'date', 11, 6, 'confirmed',
       'Upload it at myinsuranceinfo.com (the bank''s insurance tracking service); their confirmation email marks it sent.',
       'Was Central Valley Community Bank. Uploaded Nov 1, 2022, Jan 28, 2025 and Nov 6, 2025: the property evidence (EOP) for 41777 Tollhouse, the certificate for liability, umbrella and workers'' comp, and the Powell & Son DIC.'
  from public.accounting_contacts c
 where c.id = 'b3b73718-f3e8-490c-9b23-d7f80ffe7823'
   and not exists (select 1 from public.accounting_policy_recipients r where r.organization_id = c.organization_id and r.send_how ilike '%myinsuranceinfo%');
update public.accounting_policy_recipients set status = 'ignored',
       notes = 'Not a requester: Myinsuranceinfo is Community West Bank''s upload service; its confirmations mark the bank''s proof sent.'
 where company = 'Myinsuranceinfo' and status = 'proposed';

-- Back-check: past Myinsuranceinfo confirmations become the bank's sends.
select public.myinsuranceinfo_confirmation(e.id)
  from public.emails e join public.mailboxes b on b.id = e.mailbox_id and b.kind = 'accounting'
 where e.from_email ilike '%@myinsuranceinfo.com' order by e.received_at;

-- Policies: the personal ones and Markel, in the hosted org that has the insurance list.
insert into public.accounting_policies (organization_id, label, property, coverage_description, coverage_type, carrier, agent_contact_id, policy_number,
       prior_policy_numbers, named_insured, building_owner, paid_by, coverage_limits, renewal_date, autopay, billed_with, notes, is_active, sort_order, personal)
select o.id, v.label, v.property, v.descr, v.ctype, v.carrier,
       case when v.goosehead then (select c.id from public.accounting_contacts c where c.organization_id = o.id and c.company = 'Goosehead' and c.merged_into is null limit 1) end,
       v.number, v.prior, v.insured, '', '', '', v.renewal, v.autopay, '', v.notes, true, v.sort, v.personal
  from public.organizations o
  cross join (values
    ('35775 Aunt Julia, fire (Cal Fair)', '35775 Aunt Julia Lane', 'Dwelling', 'fire_only', 'Cal Fair Plan', 'CFP 0100341142', '{}'::text[], 'Gregory Powell', date '2027-05-08', false,
     'Goosehead''s Apr 20, 2026 renewal notice: renews May 8, $5,184.50 for 2026-27. Wells Fargo is the mortgagee.', 30, true, true),
    ('35775 Aunt Julia, wrap / DIC (Bamboo)', '35775 Aunt Julia Lane', 'Supplemental (DIC) for the residence', 'dic', 'Bamboo', 'BSNH3-2023-105727-01', '{}'::text[], 'Gregory Powell', null::date, false,
     'Renewal date to fill in (Bamboo''s renewal emails came May 24 and 30, 2026). Bamboo is the wrap for 35775 (Dana, Nov 2: Bamboo and Steadily are the personal wraps; Steadily covers 35771 and SJ&E).', 31, true, true),
    ('35771 Aunt Julia, fire (Cal Fair)', '35771 Aunt Julia Lane', 'Dwelling', 'fire_only', 'Cal Fair Plan', 'CFP 0102401593 00', '{}'::text[], '', date '2027-10-30', false,
     '2026-27 paid $4,618.23 (receipt Oct 29, 2026).', 32, true, true),
    ('35771 Aunt Julia, wrap / DIC (Steadily)', '35771 Aunt Julia Lane', 'DIC', 'dic', 'Steadily (Hudson)', 'SP3-CA-20740864-01', array['SP3-CA-20740864-00'], '', date '2027-10-30', false,
     '2026-27 paid $944.10 (receipt Oct 29, 2026).', 33, true, true),
    ('SJ&E Road, fire (Cal Fair)', '34484 SJ&E Road', 'Dwelling (rental)', 'fire_only', 'Cal Fair Plan', 'CFP 0102402240 00', '{}'::text[], '', date '2026-10-30', false,
     '2025-26 paid $2,253 (Oct 30, 2025). No 2026-27 renewal or receipt found in billing@ yet.', 34, true, true),
    ('SJ&E Road, wrap / DIC (Steadily)', '34484 SJ&E Road', 'DIC', 'dic', 'Steadily (Hudson)', 'SP3-CA-21323788-00', '{}'::text[], '', date '2026-10-30', false,
     '2025-26 $982.27 (Oct 30, 2025); Steadily sent a cancel notice Dec 16, 2025 and rescinded it Jan 5, 2026. No 2026-27 renewal found in billing@ yet.', 35, true, true),
    ('Personal auto (Drive / Progressive)', '', 'Tyler''s truck, Greg''s truck, Dana''s Toyota', 'auto', 'Drive Insurance (Progressive)', '963278000', '{}'::text[], 'Gregory Powell', date '2026-11-09', true,
     'Six-month terms, paid automatically by card about May 9 and Nov 9 (May 9, 2026: $3,015.64).', 36, true, true),
    ('Marina wave runner liability (Markel)', 'Shaver Lake Marina', 'Watercraft rental liability for the wave runners', 'liability', 'Markel American', 'MTD00000469812', '{}'::text[], 'SLS', date '2027-05-14', true,
     'On autopay. The big yearly payment comes about mid-May ($20,303 on May 14, 2026); adding a wave runner during the season can bring extra payments. Renewal date from the payment date.', 25, false, false)
  ) as v(label, property, descr, ctype, carrier, number, prior, insured, renewal, autopay, notes, sort, goosehead, personal)
 where exists (select 1 from public.accounting_policies p where p.organization_id = o.id and p.policy_number = 'SL2923292')
   and not exists (select 1 from public.accounting_policies p where p.organization_id = o.id and p.policy_number = v.number);

insert into public.accounting_policy_terms (organization_id, policy_id, term_label, premium, paid_on, paid_from)
select p.organization_id, p.id, v.term, v.premium, v.paid_on, ''
  from public.accounting_policies p
  join (values ('CFP 0102401593 00', '2026-27', 4618.23, date '2026-10-29'), ('SP3-CA-20740864-01', '2026-27', 944.10, date '2026-10-29'),
               ('CFP 0102402240 00', '2025-26', 2253.00, date '2025-10-30'), ('SP3-CA-21323788-00', '2025-26', 982.27, date '2025-10-30'),
               ('MTD00000469812', '2026-27', 20303.00, date '2026-05-14')) as v(number, term, premium, paid_on) on v.number = p.policy_number
on conflict (policy_id, term_label) do nothing;

-- Papers: personal insurers and the personal homes' policies move to Personal insurance, tied to their policy.
update public.accounting_documents d set category = 'personal_insurance'
 where d.category <> 'personal_insurance'
   and (d.party ~* '^(bamboo|steadily|drive|drive insurance|goosehead|progressive|pacific coastal)$'
        or (d.party ~* '^(cal fair|hudson)$' and (d.what ~* '(aunt j|sje|sj ?& ?e|35771|35775)' or d.number ~* '(0102401593|0102402240|0100341142|CFPQ0102318881|CFPQ0102319458|20740864|21323788)')));
update public.accounting_documents d set policy_id = p.id
  from public.accounting_policies p
 where p.organization_id = d.organization_id and d.policy_id is null and p.policy_number <> ''
   and substring(p.policy_number from '(\d{6,})') is not null
   and d.number like '%' || substring(p.policy_number from '(\d{6,})') || '%'
   and (p.personal or p.policy_number = 'MTD00000469812');

-- Repeating autopays.
insert into public.autopay_schedules (organization_id, payee, what, payee_match, every_months, next_on, amount, automatic, personal, policy_id, last_email_id, note)
select o.id, v.payee, v.what, v.match, v.every, v.next_on, v.amount, true, v.personal,
       (select p.id from public.accounting_policies p where p.organization_id = o.id and p.policy_number = v.number limit 1),
       (select e.id from public.emails e join public.mailboxes b on b.id = e.mailbox_id and b.kind = 'accounting'
         where e.organization_id = o.id and e.from_email ~* v.from_re and coalesce(e.subject, '') ~* v.subj_re order by e.received_at desc limit 1),
       v.note
  from public.organizations o
  cross join (values
    ('Drive Insurance', 'personal auto 963278000', '(drive|progressive)', 6, date '2026-11-09', 3015.64::numeric, true, '963278000', 'driveinsurance', 'scheduled payment', ''),
    ('Markel', 'marina wave runner liability', 'markel', 12, date '2027-05-14', 20303.00, false, 'MTD00000469812', 'markel', 'automatic payment', 'Extra payments during the season get their own reminder when Markel emails.'),
    ('Hub International', 'commercial insurance invoices', '^hub', 12, date '2027-08-14', 79553.00, false, null, 'hubinternational', 'automatic payment', 'Aug 14, 2026 paid invoices OMO4815073 ($62,560) and XLO0037371 ($16,993).'),
    ('IRS', 'federal estimated tax, January', '(irs|internal revenue)', 12, date '2027-01-15', 87000.00, false, null, 'mbsaccountancy', 'estimated taxes', 'Our accountant sets these to come out automatically.'),
    ('IRS', 'federal estimated tax, June', '(irs|internal revenue)', 12, date '2027-06-15', null, false, null, 'irs', 'direct pay', 'Our accountant sets these to come out automatically.'),
    ('IRS', 'federal estimated tax, September', '(irs|internal revenue)', 12, date '2027-09-15', 74000.00, false, null, 'mbsaccountancy', 'estimated tax', 'Our accountant sets these to come out automatically.'),
    ('FTB', 'California estimated tax, January', '(ftb|franchise)', 12, date '2027-01-15', 7000.00, false, null, 'mbsaccountancy', 'estimated taxes', 'Our accountant sets these to come out automatically.'),
    ('FTB', 'California estimated tax, June', '(ftb|franchise)', 12, date '2027-06-15', 11990.00, false, null, '(ftb|webpay|franchise)', '', 'Our accountant sets these to come out automatically.')
  ) as v(payee, what, match, every, next_on, amount, personal, number, from_re, subj_re, note)
 where exists (select 1 from public.accounting_policies p where p.organization_id = o.id and p.policy_number = 'SL2923292')
   and not exists (select 1 from public.autopay_schedules a where a.organization_id = o.id and a.payee = v.payee and a.next_on = v.next_on);

-- Make this year's tasks now (the bank's proof, Drive's Nov 9 autopay, renewals in the next 45 days).
select public.accounting_sync_policy_tasks(null);
select public.autopay_schedule_tasks(null);
