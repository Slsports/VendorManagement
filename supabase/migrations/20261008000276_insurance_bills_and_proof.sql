-- 0276 — Insurance bills and proof for SCE (Dana, Nov 2: "These need a task and they need to go to SCE when we get the
-- updated policy each year … go on everything"). Travelers' billing emails (to billing.slsports@gmail.com, in the
-- billing@ inbox) had been filed and nothing else.
--   • A billing email that carries a tracked policy's number (Travelers: "BILLING ACCOUNT 7276G0232"):
--       bill ready → a task "Pay <policy>: $<minimum> due <date>" (balance and due date in the notes), reminded 5 days
--       before the due date; due-soon reminder or past due → the same task, reminded right away (past due says so);
--       payment confirmation → the payment goes on the policy year (amount, date, the email one click away) and the
--       open bill task closes with what VMS saw.
--   • A new policy paper filed to a policy (Accounting documents, kind policy) for the current or next policy year
--     makes the "Send … to <who>" tasks for everyone who needs proof of it (SCE for Travelers, workers' comp and general
--     liability), as clicking "Policy received" did. Old papers filed later never do.
--   Back-check: every billing email on file (payments recorded; tasks only for bills due in the last 30 days or later),
--   and each policy's newest paper for the current year.

set local lock_timeout = '5s';

alter table public.accounting_policy_terms add column if not exists paid_amount numeric(12,2),
  add column if not exists paid_email_id uuid references public.emails(id) on delete set null;
comment on column public.accounting_policy_terms.paid_amount is 'The last payment read from the insurer''s payment confirmation email (Dana, Nov 2).';
comment on column public.accounting_policy_terms.paid_email_id is 'That payment confirmation email, one click away.';

-- the policy year a date falls in: "2026-27" for a policy renewing Jul 3 and a date from Jul 3, 2026 to Jul 2, 2027
create or replace function public.insurance_term_label(p_policy uuid, p_date date) returns text
language plpgsql stable security definer set search_path = public as $$
declare r date; a date;
begin
  select renewal_date into r from public.accounting_policies where id = p_policy;
  if p_date is null then return null; end if;
  if r is null then return extract(year from p_date)::int || '-' || to_char(p_date + interval '1 year', 'YY'); end if;
  a := make_date(extract(year from p_date)::int, extract(month from r)::int, least(extract(day from r)::int, 28));
  if extract(day from r) > 28 then a := a + (extract(day from r)::int - 28); end if;
  if a > p_date then a := (a - interval '1 year')::date; end if;
  return to_char(a, 'YYYY') || '-' || to_char(a + interval '1 year', 'YY');
end;
$$;

-- "Policy received" without the person check, for VMS itself (0116's body)
create or replace function public.accounting_policy_received_core(p_policy uuid, p_term text, p_document uuid default null) returns integer
language plpgsql security definer set search_path = public as $$
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
            || case when r.why <> '' then ' (' || r.why || ')' else '' end || '. Send to ' || r.email || ' from billing@.',
            current_date + 7, ((current_date + 7)::timestamp + time '09:00') at time zone 'America/Los_Angeles', v_owner, v_key, 'accounting', v_proc, p_policy, r.id);
    n := n + 1;
  end loop;
  return n;
end;
$$;
revoke execute on function public.accounting_policy_received_core(uuid, text, uuid) from public, anon, authenticated;

create or replace function public.accounting_policy_received(p_policy uuid, p_term text, p_document uuid default null) returns integer
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is not null and not public.sees_accounting() then raise exception 'Accounting only' using errcode = '42501'; end if;
  return public.accounting_policy_received_core(p_policy, p_term, p_document);
end;
$$;

-- a new policy paper filed to a policy: proof goes out to whoever needs it (current or next year only)
create or replace function public.accounting_documents_policy_received() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_term text;
begin
  if new.policy_id is null or new.kind <> 'policy' then return null; end if;
  if tg_op = 'UPDATE' and old.policy_id is not distinct from new.policy_id and old.kind is not distinct from new.kind then return null; end if;
  v_term := public.insurance_term_label(new.policy_id, coalesce(new.doc_date, (new.created_at at time zone 'America/Los_Angeles')::date));
  if v_term is null or v_term < public.insurance_term_label(new.policy_id, current_date) then return null; end if;
  perform public.accounting_policy_received_core(new.policy_id, v_term, null);
  return null;
end;
$$;
drop trigger if exists accounting_documents_policy_received on public.accounting_documents;
create trigger accounting_documents_policy_received after insert or update of policy_id, kind on public.accounting_documents
  for each row execute function public.accounting_documents_policy_received();

-- an insurer's billing email (billing@): bill → task, payment → paid on the policy year and the task closed
create or replace function public.insurance_bill_email(p_email uuid, p_backcheck boolean default false) returns text
language plpgsql security definer set search_path = public as $$
declare
  e record; pol public.accounting_policies%rowtype;
  t text; v_kind text; v_due date; v_min numeric; v_bal numeric; v_amt numeric; v_on date; v_conf text; v_term text;
  v_key text; v_owner uuid; v_title text; v_notes text; v_remind timestamptz; v_line text; n integer;
  money_of constant text := '\$\s?([0-9][0-9,]*\.[0-9]{2})';
begin
  select em.id, em.organization_id, em.subject, em.body_text, em.received_at, em.thread_id, em.direction, b.kind as box_kind
    into e from public.emails em left join public.mailboxes b on b.id = em.mailbox_id where em.id = p_email;
  if e.id is null or e.direction <> 'in' or e.box_kind is distinct from 'accounting' then return null; end if;
  t := regexp_replace(regexp_replace(coalesce(e.body_text, ''), '(&zwnj;|&nbsp;|' || chr(8204) || ')', ' ', 'g'), '\s+', ' ', 'g');
  select * into pol from public.accounting_policies p
   where p.organization_id = e.organization_id and p.is_active
     and length(regexp_replace(coalesce(p.policy_number, ''), '[^A-Za-z0-9]', '', 'g')) >= 6
     and position(upper(p.policy_number) in upper(t)) > 0
   order by p.updated_at desc limit 1;
  if pol.id is null then return null; end if;
  v_kind := case when e.subject ~* '(payment confirmation|payment received|thank you for (your )?payment|payment (has been |is )?scheduled)' then 'paid'
                 when e.subject ~* '(past due|overdue|late payment|missed payment)' then 'past_due'
                 when e.subject ~* '(payment is due|due soon|payment reminder)' then 'due_soon'
                 when e.subject ~* '((bill|statement|invoice) is (ready|available)|new bill)' then 'bill'
                 end;
  if v_kind is null then return null; end if;
  v_owner := public.accounting_owner(e.organization_id);

  if v_kind = 'paid' then
    v_amt := replace(coalesce(substring(t from '(?i)payment amount ' || money_of), substring(t from '(?i)payment of ' || money_of)), ',', '')::numeric;
    v_on := coalesce(to_date(substring(t from '(?i)scheduled for (\d{2}/\d{2}/\d{4})'), 'MM/DD/YYYY'), (e.received_at at time zone 'America/Los_Angeles')::date);
    v_conf := substring(t from '(?i)confirmation (?:number |no\.? |#)?:?\s?([0-9A-Z-]{6,})');
    v_term := public.insurance_term_label(pol.id, v_on);
    v_line := format('Paid %s on %s%s (the insurer''s payment confirmation).', coalesce('$' || to_char(v_amt, 'FM999,999,990.00'), 'a payment'),
                     to_char(v_on, 'FMMM/FMDD/YYYY'), coalesce(', confirmation ' || v_conf, ''));
    insert into public.accounting_policy_terms (organization_id, policy_id, term_label, paid_on, paid_amount, paid_email_id, notes)
    values (e.organization_id, pol.id, v_term, v_on, v_amt, e.id, v_line)
    on conflict (policy_id, term_label) do update set
      paid_on = greatest(coalesce(accounting_policy_terms.paid_on, excluded.paid_on), excluded.paid_on),
      paid_amount = case when excluded.paid_on >= coalesce(accounting_policy_terms.paid_on, excluded.paid_on) then excluded.paid_amount else accounting_policy_terms.paid_amount end,
      paid_email_id = case when excluded.paid_on >= coalesce(accounting_policy_terms.paid_on, excluded.paid_on) then excluded.paid_email_id else accounting_policy_terms.paid_email_id end,
      notes = case when coalesce(accounting_policy_terms.notes, '') like '%' || v_line || '%' then accounting_policy_terms.notes
                   else concat_ws(E'\n', nullif(accounting_policy_terms.notes, ''), v_line) end;
    update public.tasks set done_at = now(), done_note = 'VMS saw ' || coalesce(nullif(pol.carrier, ''), 'the insurer') || '''s payment confirmation: ' || v_line
     where organization_id = e.organization_id and auto_key like 'policy_bill:' || pol.id || ':%' and done_at is null;
    return 'paid';
  end if;

  v_due := to_date(substring(t from '(?i)(?:bill due date|due date|due by|due on)\s?:?\s?(\d{2}/\d{2}/\d{4})'), 'MM/DD/YYYY');
  v_min := replace(coalesce(substring(t from '(?i)minimum due ' || money_of), substring(t from '(?i)amount due ' || money_of), substring(t from '(?i)payment of ' || money_of)), ',', '')::numeric;
  v_bal := replace(substring(t from '(?i)(?:remaining|total|account) balance ' || money_of), ',', '')::numeric;
  if p_backcheck and (v_due is null or v_due < current_date - 30) then return 'old'; end if;
  -- already paid (a payment confirmation came after it): nothing to do
  if exists (select 1 from public.accounting_policy_terms tm where tm.policy_id = pol.id and tm.paid_email_id is not null
              and tm.paid_on >= coalesce(v_due, (e.received_at at time zone 'America/Los_Angeles')::date) - 45
              and (select received_at from public.emails where id = tm.paid_email_id) > e.received_at) then return 'paid already'; end if;
  v_key := 'policy_bill:' || pol.id || ':' || coalesce(v_due::text, to_char(e.received_at at time zone 'America/Los_Angeles', 'YYYY-MM-DD'));
  v_title := left(case when v_kind = 'past_due' then 'PAST DUE: ' else '' end || 'Pay ' || pol.label
             || coalesce(': $' || to_char(v_min, 'FM999,999,990.00'), '') || coalesce(' due ' || to_char(v_due, 'Mon FMDD, YYYY'), ''), 200);
  v_notes := concat_ws(' ',
    coalesce('Minimum due $' || to_char(v_min, 'FM999,999,990.00') || '.', null),
    coalesce('Balance $' || to_char(v_bal, 'FM999,999,990.00') || '.', null),
    coalesce('Due ' || to_char(v_due, 'Mon FMDD, YYYY') || '.', null),
    'Account ' || pol.policy_number || '.',
    case when pol.autopay then 'On autopay: make sure the bank account covers it.' else 'Pay on the insurer''s site (Pay now in the email).' end,
    'VMS closes this when the payment confirmation comes in. Click to open the email.');
  v_remind := case when v_kind = 'bill' and v_due is not null then greatest(now(), ((v_due - 5)::timestamp + time '09:00') at time zone 'America/Los_Angeles') else now() end;
  insert into public.tasks (organization_id, title, notes, due_date, remind_at, assigned_to, auto_key, area, policy_id, thread_id)
  values (e.organization_id, v_title, v_notes, coalesce(v_due, (e.received_at at time zone 'America/Los_Angeles')::date + 14), v_remind, v_owner, v_key, 'accounting', pol.id, e.thread_id)
  on conflict (organization_id, auto_key) where auto_key is not null do update set
    title = excluded.title, notes = excluded.notes, thread_id = excluded.thread_id,
    remind_at = case when tasks.done_at is null and excluded.remind_at < coalesce(tasks.remind_at, excluded.remind_at) then excluded.remind_at else tasks.remind_at end,
    reminded_at = case when tasks.done_at is null and excluded.remind_at < coalesce(tasks.remind_at, excluded.remind_at) then null else tasks.reminded_at end
   where tasks.done_at is null;
  return v_kind;
end;
$$;
revoke execute on function public.insurance_bill_email(uuid, boolean) from public, anon, authenticated;
grant execute on function public.insurance_bill_email(uuid, boolean) to service_role;

create or replace function public.emails_insurance_bill() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.direction = 'in' and new.mailbox_id is not null
     and exists (select 1 from public.mailboxes b where b.id = new.mailbox_id and b.kind = 'accounting') then
    perform public.insurance_bill_email(new.id, false);
  end if;
  return null;
end;
$$;
drop trigger if exists emails_insurance_bill on public.emails;
create trigger emails_insurance_bill after insert on public.emails for each row execute function public.emails_insurance_bill();

-- back-check: every billing email on file, oldest first
select public.insurance_bill_email(e.id, true)
  from public.emails e join public.mailboxes b on b.id = e.mailbox_id and b.kind = 'accounting'
 where e.direction = 'in' and e.subject ~* '(payment|bill|statement|invoice|due)'
 order by e.received_at;
-- and each policy's newest paper for the current year
select public.accounting_policy_received_core(d.policy_id, public.insurance_term_label(d.policy_id, coalesce(d.doc_date, d.created_at::date)), null)
  from (select distinct on (policy_id) policy_id, doc_date, created_at from public.accounting_documents
         where kind = 'policy' and policy_id is not null order by policy_id, coalesce(doc_date, created_at::date) desc) d
 where public.insurance_term_label(d.policy_id, coalesce(d.doc_date, d.created_at::date)) >= public.insurance_term_label(d.policy_id, current_date)
   and exists (select 1 from public.accounting_policy_recipients r where r.status = 'confirmed' and d.policy_id = any (r.policy_ids));
