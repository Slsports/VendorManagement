-- 0118 — No "start the renewal" task when the renewal is already under way: a later contract with the same number is
-- on file (pending or active). The two SCE 2023–2027 licenses got such tasks on Oct 16 although the store's 2028–2032
-- license is executed and the Marina's is pending.
create or replace function public.accounting_sync_contract_tasks(p_org uuid default null) returns integer
language plpgsql security definer set search_path = public as $$
declare r record; n integer := 0; v_owner uuid; v_key text; v_due date;
begin
  if auth.uid() is not null and not public.sees_accounting() then raise exception 'Accounting only' using errcode = '42501'; end if;
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
  for r in
    select c.* from public.accounting_contracts c
     where c.status = 'active' and c.term_end is not null and (p_org is null or c.organization_id = p_org)
       and c.term_end - c.renewal_lead_days <= current_date + 45
       -- the renewal is already under way when a later agreement with the same number is on file
       and not exists (select 1 from public.accounting_contracts s where s.organization_id = c.organization_id and s.id <> c.id
                         and s.contract_number <> '' and s.contract_number = c.contract_number and s.term_start >= c.term_end and s.status in ('pending', 'active'))
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

-- Renewal tasks already made for a contract whose successor is on file are closed as "already under way".
update public.tasks t set done_at = now(), done_note = 'Renewal already under way: the next agreement is on file', done_notified_at = now(), done_seen_at = now()
 where t.auto_key like 'contract_renewal:%' and t.done_at is null
   and exists (select 1 from public.accounting_contracts c join public.accounting_contracts s on s.organization_id = c.organization_id and s.id <> c.id
                 and s.contract_number <> '' and s.contract_number = c.contract_number and s.term_start >= c.term_end and s.status in ('pending', 'active')
               where c.id = t.contract_id);
