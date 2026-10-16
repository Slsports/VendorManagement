-- 0117 — Contracts tracker (Dana, Oct 16: the SCE license agreements for the Marina and the Camp Edison store, renewed
-- every five years; later leases, the commercial loan, other contracts). Each contract: the other party and contact,
-- term, who signs, the insurance it requires, its payment schedule, the season it covers, the renewal procedure.
-- Tasks made on their own: each payment 30 days ahead, "start the renewal" at the lead time before the term ends, and
-- a follow-up when something is pending (an offer letter sent, a DocuSign awaited). Private to the Accounting tick.

create table if not exists public.accounting_contracts (
  id                  uuid primary key default gen_random_uuid(),
  organization_id     uuid not null references public.organizations(id) on delete cascade,
  label               text not null check (length(trim(label)) > 0),
  kind                text not null default 'contract' check (kind in ('license', 'lease', 'loan', 'contract', 'other')),
  other_party         text not null default '',
  contact_id          uuid references public.accounting_contacts(id) on delete set null,
  contract_number     text not null default '',
  prior_numbers       text[] not null default '{}',
  term_start          date,
  term_end            date,
  renewal_lead_days   integer not null default 540,
  signer              text not null default '',
  notices_to          text not null default '',
  insurance_required  text not null default '',
  requires_policy_ids uuid[] not null default '{}',
  season_open         text not null default '',
  season_close        text not null default '',
  status              text not null default 'active' check (status in ('pending', 'active', 'expired', 'ended')),
  follow_up_on        date,
  follow_up_note      text not null default '',
  procedure_id        uuid references public.accounting_procedures(id) on delete set null,
  notes               text not null default '',
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);
comment on table public.accounting_contracts is 'Contracts tracker (Dana, Oct 16): licenses, leases, loans. Term, payments, insurance required, renewal lead time, season.';
create index if not exists accounting_contracts_org_idx on public.accounting_contracts (organization_id, status, term_end);
drop trigger if exists accounting_contracts_updated_at on public.accounting_contracts;
create trigger accounting_contracts_updated_at before update on public.accounting_contracts for each row execute function public.set_updated_at();

create table if not exists public.accounting_contract_payments (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations(id) on delete cascade,
  contract_id      uuid not null references public.accounting_contracts(id) on delete cascade,
  label            text not null default '',
  due_on           date not null,
  amount           numeric(12, 2),
  paid_on          date,
  paid_from        text not null default '',
  notes            text not null default '',
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index if not exists accounting_contract_payments_contract_idx on public.accounting_contract_payments (contract_id, due_on);
drop trigger if exists accounting_contract_payments_updated_at on public.accounting_contract_payments;
create trigger accounting_contract_payments_updated_at before update on public.accounting_contract_payments for each row execute function public.set_updated_at();

alter table public.tasks add column if not exists contract_id uuid references public.accounting_contracts(id) on delete set null;

do $$
declare t text;
begin
  foreach t in array array['accounting_contracts', 'accounting_contract_payments'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists "%s: accounting people" on public.%I', t, t);
    execute format('create policy "%s: accounting people" on public.%I for all to authenticated using (public.user_in_org(organization_id) and public.sees_accounting()) with check (public.user_in_org(organization_id) and public.sees_accounting())', t, t);
    execute format('grant select, insert, update, delete on table public.%I to authenticated', t);
    execute format('grant all on table public.%I to service_role', t);
  end loop;
end $$;

-- The next repeat of a task keeps its contract too.
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

-- Contract tasks: payments (30 days ahead, until paid), start-the-renewal at the lead time, follow-ups while pending.
create or replace function public.accounting_sync_contract_tasks(p_org uuid default null) returns integer
language plpgsql security definer set search_path = public as $$
declare r record; n integer := 0; v_owner uuid; v_key text; v_due date;
begin
  if auth.uid() is not null and not public.sees_accounting() then raise exception 'Accounting only' using errcode = '42501'; end if;
  -- payments due within 45 days (or up to 30 days overdue) and not paid
  for r in
    select p.*, c.label as contract_label, c.other_party, c.procedure_id
      from public.accounting_contract_payments p join public.accounting_contracts c on c.id = p.contract_id
     where p.paid_on is null and c.status in ('pending', 'active') and (p_org is null or p.organization_id = p_org)
       and p.due_on between current_date - 30 and current_date + 45
  loop
    v_owner := public.accounting_owner(r.organization_id);
    if v_owner is null then continue; end if;
    v_key := 'contract_payment:' || r.id;
    if exists (select 1 from public.tasks t where t.organization_id = r.organization_id and t.auto_key = v_key) then continue; end if;
    insert into public.tasks (organization_id, title, notes, due_date, remind_at, assigned_to, auto_key, area, contract_id)
    values (r.organization_id,
            'Pay ' || r.contract_label || case when r.label <> '' then ' (' || r.label || ')' else '' end || case when r.amount is not null then ': ' || to_char(r.amount, 'FM$999,999,990.00') else '' end,
            'Due ' || to_char(r.due_on, 'Mon DD, YYYY') || case when r.other_party <> '' then ' to ' || r.other_party else '' end || case when r.notes <> '' then '. ' || r.notes else '' end
            || '. Mark it paid on the contract page when the check goes out.',
            r.due_on, ((r.due_on - 30)::timestamp + time '09:00') at time zone 'America/Los_Angeles', v_owner, v_key, 'accounting', r.contract_id);
    n := n + 1;
  end loop;
  -- start the renewal at the lead time before the term ends (active contracts only)
  for r in
    select c.* from public.accounting_contracts c
     where c.status = 'active' and c.term_end is not null and (p_org is null or c.organization_id = p_org)
       and c.term_end - c.renewal_lead_days <= current_date + 45
  loop
    v_owner := public.accounting_owner(r.organization_id);
    if v_owner is null then continue; end if;
    v_key := 'contract_renewal:' || r.id || ':' || r.term_end;
    if exists (select 1 from public.tasks t where t.organization_id = r.organization_id and t.auto_key = v_key) then continue; end if;
    v_due := greatest(r.term_end - r.renewal_lead_days, current_date);
    insert into public.tasks (organization_id, title, notes, due_date, remind_at, assigned_to, auto_key, area, contract_id, procedure_id)
    values (r.organization_id, 'Start the renewal: ' || r.label,
            'The term ends ' || to_char(r.term_end, 'Mon DD, YYYY') || '. ' || case when r.other_party <> '' then r.other_party || ' ' else '' end
            || 'usually starts the paperwork about ' || round(r.renewal_lead_days / 30.0) || ' months out; if nothing has come, ask them.',
            v_due, (v_due::timestamp + time '09:00') at time zone 'America/Los_Angeles', v_owner, v_key, 'accounting', r.id, r.procedure_id);
    n := n + 1;
  end loop;
  -- follow-ups while something is pending
  for r in
    select c.* from public.accounting_contracts c
     where c.follow_up_on is not null and (p_org is null or c.organization_id = p_org) and c.follow_up_on <= current_date + 45
  loop
    v_owner := public.accounting_owner(r.organization_id);
    if v_owner is null then continue; end if;
    v_key := 'contract_followup:' || r.id || ':' || r.follow_up_on;
    if exists (select 1 from public.tasks t where t.organization_id = r.organization_id and t.auto_key = v_key) then continue; end if;
    insert into public.tasks (organization_id, title, notes, due_date, remind_at, assigned_to, auto_key, area, contract_id, procedure_id)
    values (r.organization_id, 'Follow up: ' || r.label, coalesce(nullif(r.follow_up_note, ''), 'Check where it stands.'),
            r.follow_up_on, (r.follow_up_on::timestamp + time '09:00') at time zone 'America/Los_Angeles', v_owner, v_key, 'accounting', r.id, r.procedure_id);
    n := n + 1;
  end loop;
  return n;
end;
$$;

-- A payment went out: stamp it, close its task.
create or replace function public.accounting_contract_payment_paid(p_payment uuid, p_paid_on date default current_date, p_paid_from text default '') returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.sees_accounting() then raise exception 'Accounting only' using errcode = '42501'; end if;
  update public.accounting_contract_payments set paid_on = p_paid_on, paid_from = case when p_paid_from <> '' then p_paid_from else paid_from end where id = p_payment;
  update public.tasks set done_at = now(), done_by = auth.uid(), done_notified_at = now(), done_seen_at = now()
   where auto_key = 'contract_payment:' || p_payment and done_at is null;
end;
$$;

-- A follow-up answered: clear it and close its task.
create or replace function public.accounting_contract_followup_done(p_contract uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.sees_accounting() then raise exception 'Accounting only' using errcode = '42501'; end if;
  update public.tasks set done_at = now(), done_by = auth.uid(), done_notified_at = now(), done_seen_at = now()
   where contract_id = p_contract and auto_key like 'contract_followup:%' and done_at is null;
  update public.accounting_contracts set follow_up_on = null, follow_up_note = '' where id = p_contract;
end;
$$;

-- One daily job for all of Accounting's automatic tasks.
create or replace function public.accounting_sync_all_tasks(p_org uuid default null) returns integer
language sql security definer set search_path = public as $$
  select public.accounting_sync_policy_tasks(p_org) + public.accounting_sync_contract_tasks(p_org)
$$;

revoke execute on function public.accounting_sync_contract_tasks(uuid), public.accounting_contract_payment_paid(uuid, date, text), public.accounting_contract_followup_done(uuid), public.accounting_sync_all_tasks(uuid) from public, anon;
grant execute on function public.accounting_sync_contract_tasks(uuid), public.accounting_contract_payment_paid(uuid, date, text), public.accounting_contract_followup_done(uuid), public.accounting_sync_all_tasks(uuid) to authenticated, service_role;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule(jobid) from cron.job where jobname in ('accounting-policy-tasks', 'accounting-tasks');
    perform cron.schedule('accounting-tasks', '15 13 * * *', 'select public.accounting_sync_all_tasks()');
  end if;
end $$;
