-- 0116 — Accounting as a training program (Dana, Oct 16; docs/accounting-plan.md §6 + decisions Oct 16):
--   • accounting tasks: tasks.area = 'accounting', seen only with the Accounting tick, each one can carry its procedure
--   • procedures: the handbook, one per job, plain Markdown (same reader as Help)
--   • insurance tracker: policies (the Cal Fair + Hudson guide), their yearly terms (premium, date paid), renewal tasks
--     made 30 days ahead with the checklist; who needs proof of insurance every year (lender, contract partners),
--     proposed from the requests found in the mail, and the send tasks made when a policy comes in
-- Everything accounting is RLS'd on sees_accounting(); nothing here is visible to managers or buyers.

-- ---------------------------------------------------------------------------------------------------------------------
-- Procedures
-- ---------------------------------------------------------------------------------------------------------------------
create table if not exists public.accounting_procedures (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations(id) on delete cascade,
  slug             text not null,
  title            text not null check (length(trim(title)) > 0),
  category         text not null default 'other'
                   check (category in ('taxes', 'insurance', 'banking', 'payroll', 'donations', 'contracts', 'accounting_firm', 'bills', 'other')),
  summary          text not null default '',
  body             text not null default '',
  updated_by       uuid references public.profiles(id) on delete set null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (organization_id, slug)
);
comment on table public.accounting_procedures is 'The accounting handbook (Dana, Oct 16): one procedure per job, in plain steps, so someone else could do it.';
drop trigger if exists accounting_procedures_updated_at on public.accounting_procedures;
create trigger accounting_procedures_updated_at before update on public.accounting_procedures for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------------------------------------------------
-- Insurance: policies, their terms, who needs proof, what was sent
-- ---------------------------------------------------------------------------------------------------------------------
create table if not exists public.accounting_policies (
  id                    uuid primary key default gen_random_uuid(),
  organization_id       uuid not null references public.organizations(id) on delete cascade,
  label                 text not null check (length(trim(label)) > 0),
  property              text not null default '',
  coverage_description  text not null default '',
  coverage_type         text not null default 'other'
                        check (coverage_type in ('fire_only', 'dic', 'liability', 'workers_comp', 'auto', 'umbrella', 'health', 'other')),
  carrier               text not null default '',
  agent_contact_id      uuid references public.accounting_contacts(id) on delete set null,
  policy_number         text not null default '',
  prior_policy_numbers  text[] not null default '{}',
  named_insured         text not null default '',
  building_owner        text not null default '',
  paid_by               text not null default '',
  coverage_limits       text not null default '',
  renewal_date          date,
  autopay               boolean not null default false,
  billed_with           text not null default '',
  notes                 text not null default '',
  is_active             boolean not null default true,
  sort_order            integer not null default 0,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);
comment on table public.accounting_policies is 'Insurance tracker (Dana, Oct 16): one row per policy, from the Commercial Property Insurance guide onward.';
drop trigger if exists accounting_policies_updated_at on public.accounting_policies;
create trigger accounting_policies_updated_at before update on public.accounting_policies for each row execute function public.set_updated_at();

create table if not exists public.accounting_policy_terms (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations(id) on delete cascade,
  policy_id        uuid not null references public.accounting_policies(id) on delete cascade,
  term_label       text not null check (length(trim(term_label)) > 0),
  premium          numeric(12, 2),
  paid_on          date,
  paid_from        text not null default '',
  received_at      timestamptz,
  document_id      uuid references public.vendor_links(id) on delete set null,
  notes            text not null default '',
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (policy_id, term_label)
);
comment on table public.accounting_policy_terms is 'One policy year: premium, date paid, which account, when the policy paper came in, the file.';
drop trigger if exists accounting_policy_terms_updated_at on public.accounting_policy_terms;
create trigger accounting_policy_terms_updated_at before update on public.accounting_policy_terms for each row execute function public.set_updated_at();

create table if not exists public.accounting_policy_recipients (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations(id) on delete cascade,
  company          text not null default '',
  person           text not null default '',
  email            text not null default '',
  contact_id       uuid references public.accounting_contacts(id) on delete set null,
  policy_ids       uuid[] not null default '{}',
  why              text not null default '',
  when_kind        text not null default 'renewal' check (when_kind in ('renewal', 'date')),
  due_month        integer check (due_month between 1 and 12),
  due_day          integer check (due_day between 1 and 31),
  last_sent_on     date,
  last_sent_term   text,
  last_sent_by     text check (last_sent_by in ('us', 'agent')),
  asked_at         timestamptz,
  asked_email_id   uuid references public.emails(id) on delete set null,
  status           text not null default 'proposed' check (status in ('proposed', 'confirmed', 'ignored')),
  source_email_id  uuid references public.emails(id) on delete set null,
  notes            text not null default '',
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
comment on table public.accounting_policy_recipients is 'Who needs proof of insurance every year (lender, contract partners), which policies, and when it was last sent.';
drop trigger if exists accounting_policy_recipients_updated_at on public.accounting_policy_recipients;
create trigger accounting_policy_recipients_updated_at before update on public.accounting_policy_recipients for each row execute function public.set_updated_at();

create table if not exists public.accounting_policy_sends (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations(id) on delete cascade,
  recipient_id     uuid not null references public.accounting_policy_recipients(id) on delete cascade,
  policy_id        uuid references public.accounting_policies(id) on delete set null,
  term_label       text,
  sent_on          date not null default current_date,
  sent_by          text not null default 'us' check (sent_by in ('us', 'agent')),
  email_id         uuid references public.emails(id) on delete set null,
  task_id          uuid references public.tasks(id) on delete set null,
  note             text not null default '',
  created_by       uuid references public.profiles(id) on delete set null,
  created_at       timestamptz not null default now()
);
create index if not exists accounting_policy_sends_recipient_idx on public.accounting_policy_sends (recipient_id, sent_on desc);

-- ---------------------------------------------------------------------------------------------------------------------
-- Tasks: an area, and what they are about in Accounting
-- ---------------------------------------------------------------------------------------------------------------------
alter table public.tasks add column if not exists area text not null default 'general' check (area in ('general', 'accounting'));
alter table public.tasks add column if not exists procedure_id uuid references public.accounting_procedures(id) on delete set null;
alter table public.tasks add column if not exists policy_id uuid references public.accounting_policies(id) on delete set null;
alter table public.tasks add column if not exists recipient_id uuid references public.accounting_policy_recipients(id) on delete set null;
create index if not exists tasks_area_idx on public.tasks (organization_id, area, due_date) where done_at is null;
comment on column public.tasks.area is 'general, or accounting (Dana, Oct 16): accounting tasks show only in the Accounting area, to people with the tick.';

drop policy if exists "tasks: mine, given or admin" on public.tasks;
create policy "tasks: mine, given or admin" on public.tasks for select to authenticated
  using (public.user_in_org(organization_id) and (assigned_to = auth.uid() or created_by = auth.uid() or public.is_admin())
         and (area <> 'accounting' or public.sees_accounting()));
drop policy if exists "tasks: members add" on public.tasks;
create policy "tasks: members add" on public.tasks for insert to authenticated
  with check (public.user_in_org(organization_id) and (area <> 'accounting' or public.sees_accounting()));
drop policy if exists "tasks: mine, given or admin change" on public.tasks;
create policy "tasks: mine, given or admin change" on public.tasks for update to authenticated
  using (public.user_in_org(organization_id) and (assigned_to = auth.uid() or created_by = auth.uid() or public.is_admin())
         and (area <> 'accounting' or public.sees_accounting()))
  with check (public.user_in_org(organization_id) and (area <> 'accounting' or public.sees_accounting()));
drop policy if exists "tasks: giver or admin delete" on public.tasks;
create policy "tasks: giver or admin delete" on public.tasks for delete to authenticated
  using (public.user_in_org(organization_id) and (created_by = auth.uid() or assigned_to = auth.uid() or public.is_admin())
         and (area <> 'accounting' or public.sees_accounting()));

-- The next repeat keeps the area, procedure, policy and recipient.
create or replace function public.complete_task(p_task uuid, p_note text default null)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  t public.tasks%rowtype;
  next_due date;
  next_id uuid;
begin
  select * into t from public.tasks where id = p_task for update;
  if t.id is null or not public.user_in_org(t.organization_id) or not (t.assigned_to = auth.uid() or t.created_by = auth.uid() or public.is_admin())
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
        thread_id, rep_group_id, tag_other, repeat_every, repeat_unit, repeat_days, repeat_until, repeat_of, area, procedure_id, policy_id, recipient_id)
      values (t.organization_id, t.title, t.notes, next_due,
        case when t.remind_at is not null then t.remind_at + (next_due - t.due_date) * interval '1 day' end,
        t.assigned_to, t.created_by, t.vendor_id, t.carrier_id, t.order_id, t.thread_id, t.rep_group_id, t.tag_other,
        t.repeat_every, t.repeat_unit, t.repeat_days, t.repeat_until, t.id, t.area, t.procedure_id, t.policy_id, t.recipient_id)
      returning id into next_id;
      update public.tasks set created_by = t.created_by where id = next_id;
    end if;
  end if;
  return next_id;
end;
$$;

-- ---------------------------------------------------------------------------------------------------------------------
-- RLS and grants: the Accounting tick for everything
-- ---------------------------------------------------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['accounting_procedures', 'accounting_policies', 'accounting_policy_terms', 'accounting_policy_recipients', 'accounting_policy_sends'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists "%s: accounting people" on public.%I', t, t);
    execute format('create policy "%s: accounting people" on public.%I for all to authenticated using (public.user_in_org(organization_id) and public.sees_accounting()) with check (public.user_in_org(organization_id) and public.sees_accounting())', t, t);
    execute format('grant select, insert, update, delete on table public.%I to authenticated', t);
    execute format('grant all on table public.%I to service_role', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------------------------------------------------------
-- Who does the accounting: the person accounting tasks go to (Dana: the first admin with the tick).
-- ---------------------------------------------------------------------------------------------------------------------
create or replace function public.accounting_owner(p_org uuid) returns uuid
language sql stable security definer set search_path = public as $$
  select id from public.profiles where organization_id = p_org and is_active and sees_accounting
   order by (role = 'admin') desc, created_at limit 1
$$;

-- ---------------------------------------------------------------------------------------------------------------------
-- Renewal tasks: 30 days before each active policy renews, one task with the checklist, linked to the policy and the
-- renewal procedure. Runs daily (cron) and whenever the Insurance page opens. Returns how many were made.
-- ---------------------------------------------------------------------------------------------------------------------
create or replace function public.accounting_sync_policy_tasks(p_org uuid default null) returns integer
language plpgsql security definer set search_path = public as $$
declare p record; n integer := 0; v_owner uuid; v_proc uuid; v_key text; v_title text; v_notes text;
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
  return n;
end;
$$;

-- A policy renewed: record the term (premium, date paid, which account), move the renewal date a year on, close the
-- renewal task. The policy paper itself comes separately (accounting_policy_received).
create or replace function public.accounting_policy_renewed(p_policy uuid, p_term text, p_premium numeric, p_paid_on date, p_paid_from text, p_new_renewal date, p_new_number text default null)
returns void
language plpgsql security definer set search_path = public as $$
declare pol public.accounting_policies%rowtype;
begin
  if not public.sees_accounting() then raise exception 'Accounting only' using errcode = '42501'; end if;
  select * into pol from public.accounting_policies where id = p_policy for update;
  if pol.id is null then raise exception 'Policy not found' using errcode = '23503'; end if;
  insert into public.accounting_policy_terms (organization_id, policy_id, term_label, premium, paid_on, paid_from)
  values (pol.organization_id, p_policy, p_term, p_premium, p_paid_on, coalesce(p_paid_from, ''))
  on conflict (policy_id, term_label) do update set premium = coalesce(excluded.premium, accounting_policy_terms.premium),
    paid_on = coalesce(excluded.paid_on, accounting_policy_terms.paid_on), paid_from = case when excluded.paid_from <> '' then excluded.paid_from else accounting_policy_terms.paid_from end;
  update public.accounting_policies set
    renewal_date = coalesce(p_new_renewal, renewal_date + interval '1 year'),
    prior_policy_numbers = case when p_new_number is not null and p_new_number <> '' and p_new_number <> policy_number and policy_number <> '' then array_append(prior_policy_numbers, policy_number) else prior_policy_numbers end,
    policy_number = case when p_new_number is not null and p_new_number <> '' then p_new_number else policy_number end
  where id = p_policy;
  update public.tasks set done_at = now(), done_by = auth.uid(), done_notified_at = now(), done_seen_at = now()
   where policy_id = p_policy and auto_key like 'policy_renewal:%' and done_at is null and due_date <= pol.renewal_date;
end;
$$;

-- The policy paper for a term came in (filed or uploaded): every confirmed recipient who needs this policy gets a
-- "Send … to …" task, due in a week, linked to the proof procedure. Returns how many tasks were made.
create or replace function public.accounting_policy_received(p_policy uuid, p_term text, p_document uuid default null) returns integer
language plpgsql security definer set search_path = public as $$
declare pol public.accounting_policies%rowtype; r record; n integer := 0; v_owner uuid; v_proc uuid; v_key text;
begin
  if auth.uid() is not null and not public.sees_accounting() then raise exception 'Accounting only' using errcode = '42501'; end if;
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
            || case when r.why <> '' then ' (' || r.why || ')' else '' end || '. Send to ' || r.email || ' from billing@.',
            current_date + 7, ((current_date + 7)::timestamp + time '09:00') at time zone 'America/Los_Angeles', v_owner, v_key, 'accounting', v_proc, p_policy, r.id);
    n := n + 1;
  end loop;
  return n;
end;
$$;

-- Proof went out (we sent it, or Hub did): logged, the recipient stamped, the task closed.
create or replace function public.accounting_record_send(p_recipient uuid, p_policy uuid, p_term text, p_sent_by text, p_sent_on date default current_date, p_email uuid default null, p_note text default '')
returns void
language plpgsql security definer set search_path = public as $$
declare rc public.accounting_policy_recipients%rowtype;
begin
  if not public.sees_accounting() then raise exception 'Accounting only' using errcode = '42501'; end if;
  select * into rc from public.accounting_policy_recipients where id = p_recipient for update;
  if rc.id is null then raise exception 'Recipient not found' using errcode = '23503'; end if;
  insert into public.accounting_policy_sends (organization_id, recipient_id, policy_id, term_label, sent_on, sent_by, email_id, note, created_by)
  values (rc.organization_id, p_recipient, p_policy, p_term, p_sent_on, p_sent_by, p_email, coalesce(p_note, ''), auth.uid());
  update public.accounting_policy_recipients set last_sent_on = p_sent_on, last_sent_term = p_term, last_sent_by = p_sent_by, asked_at = null, asked_email_id = null where id = p_recipient;
  update public.tasks set done_at = now(), done_by = auth.uid(), done_notified_at = now(), done_seen_at = now()
   where recipient_id = p_recipient and (p_policy is null or policy_id = p_policy) and auto_key like 'policy_send:%' and done_at is null
     and (p_term is null or auto_key like '%:' || p_term);
end;
$$;

-- Requests for proof in the mail: "certificate of insurance", "proof of insurance", "additional insured", "evidence of
-- coverage/insurance", "COI". Used to propose recipients and to flag "they asked".
create or replace function public.accounting_is_proof_request(p_subject text, p_body text) returns boolean
language sql immutable as $$
  select coalesce(p_subject, '') || ' ' || left(coalesce(p_body, ''), 4000) ~* '(certificate of (liability )?insurance|proof of insurance|additional insured|evidence of (coverage|insurance|property insurance)|insurance certificate|\mCOI\M|updated (insurance )?polic(y|ies)|copy of (the |your )?(insurance )?polic(y|ies)|renewal (certificate|declarations?)|declarations? page)'
$$;

create or replace function public.accounting_propose_recipients(p_org uuid) returns integer
language plpgsql security definer set search_path = public as $$
declare r record; n integer := 0; v_contact uuid; v_company text; v_person text;
begin
  if auth.uid() is not null and not public.sees_accounting() then raise exception 'Accounting only' using errcode = '42501'; end if;
  for r in
    select lower(e.from_email) as email, max(e.from_name) as name, max(e.received_at) as last_at, count(*) as n,
           (array_agg(e.id order by e.received_at desc))[1] as newest_id
      from public.emails e join public.mailboxes m on m.id = e.mailbox_id and m.kind = 'accounting'
     where e.organization_id = p_org and e.direction = 'in' and e.from_email is not null and e.copy_of is null
       and not coalesce(e.is_bulk, false) and not public.accounting_our_address(p_org, e.from_email)
       and split_part(lower(e.from_email), '@', 1) !~ '^(noreply|no-reply|donotreply|do-not-reply|mailer-daemon|postmaster)'
       and public.accounting_is_proof_request(e.subject, e.body_text)
       and not exists (select 1 from public.accounting_policy_recipients x where x.organization_id = p_org and x.email = lower(e.from_email))
     group by lower(e.from_email)
  loop
    v_contact := public.accounting_contact_for(p_org, r.email);
    select c.company, c.person into v_company, v_person from public.accounting_contacts c where c.id = v_contact;
    insert into public.accounting_policy_recipients (organization_id, company, person, email, contact_id, source_email_id, asked_at, asked_email_id, notes)
    values (p_org, coalesce(nullif(v_company, ''), ''), coalesce(nullif(v_person, ''), coalesce(r.name, '')), r.email, v_contact, r.newest_id, r.last_at, r.newest_id,
            'Asked ' || r.n || ' time(s) in the mail, last ' || to_char(r.last_at, 'Mon DD, YYYY') || '.');
    n := n + 1;
  end loop;
  return n;
end;
$$;

-- New mail that asks for proof, from someone on the list: flag "they asked" on their row.
create or replace function public.emails_accounting_proof_request() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.direction = 'in' and new.from_email is not null and new.mailbox_id is not null
     and exists (select 1 from public.mailboxes m where m.id = new.mailbox_id and m.kind = 'accounting')
     and public.accounting_is_proof_request(new.subject, new.body_text) then
    update public.accounting_policy_recipients set asked_at = coalesce(new.received_at, now()), asked_email_id = new.id
     where organization_id = new.organization_id and status <> 'ignored' and email = lower(new.from_email)
       and (last_sent_on is null or last_sent_on < coalesce(new.received_at, now())::date);
  end if;
  return new;
end;
$$;
drop trigger if exists emails_accounting_proof_request on public.emails;
create trigger emails_accounting_proof_request after insert on public.emails for each row execute function public.emails_accounting_proof_request();

revoke execute on function public.accounting_owner(uuid), public.accounting_sync_policy_tasks(uuid), public.accounting_policy_renewed(uuid, text, numeric, date, text, date, text),
  public.accounting_policy_received(uuid, text, uuid), public.accounting_record_send(uuid, uuid, text, text, date, uuid, text), public.accounting_is_proof_request(text, text),
  public.accounting_propose_recipients(uuid) from public, anon;
grant execute on function public.accounting_sync_policy_tasks(uuid), public.accounting_policy_renewed(uuid, text, numeric, date, text, date, text),
  public.accounting_policy_received(uuid, text, uuid), public.accounting_record_send(uuid, uuid, text, text, date, uuid, text), public.accounting_propose_recipients(uuid) to authenticated;
grant execute on function public.accounting_owner(uuid), public.accounting_sync_policy_tasks(uuid), public.accounting_policy_renewed(uuid, text, numeric, date, text, date, text),
  public.accounting_policy_received(uuid, text, uuid), public.accounting_record_send(uuid, uuid, text, text, date, uuid, text), public.accounting_is_proof_request(text, text),
  public.accounting_propose_recipients(uuid) to service_role;

-- Daily, early morning Pacific: renewal tasks for the policies renewing within 45 days.
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule(jobid) from cron.job where jobname = 'accounting-policy-tasks';
    perform cron.schedule('accounting-policy-tasks', '15 13 * * *', 'select public.accounting_sync_policy_tasks()');
  end if;
end $$;
