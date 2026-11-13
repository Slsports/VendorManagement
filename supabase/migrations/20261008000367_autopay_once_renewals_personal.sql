-- 0367 — Autopay reminders: one task, closed on the date, a check when nothing confirms it; renewals closed by VMS unless the
-- premium went up 1% or more; "Personal, not SLSI" on companies and papers; Drive Insurance folded into Progressive.
-- Dana, Nov 13: "If a company is just alerting me that our payment will be auto drafted on a certain day I should be
-- notified once and closed. There are 3 tasks for this." … "if I dont get a confirmation that an auto pay account received
-- our payment within 3 business days of the scheduled payment make a task to check on the auto payment that was supposed to
-- draft on X date." … "if it goes up more than 1% of the prior year I want a task until I look at it and close it" (then:
-- "only if it goes up at least 1% do I need to look at it") … "In accounting module I need to be able to mark a bill or
-- company as 'personal, not SLSI'" … "Progressive documents are asking what store to code them to when it clearly says that
-- this is Personal Auto" … "Drive is Progressive, same company" … "anything you mark in the backcheck … has to carry the
-- original date of the activity."
set local lock_timeout = '5s';

-- ---- columns -----------------------------------------------------------------------------------------------------------
alter table public.accounting_contacts add column if not exists personal boolean not null default false;
comment on column public.accounting_contacts.personal is 'Personal, not SLSI (Dana, Nov 13): their papers file with no store and VMS never asks which business.';
alter table public.accounting_documents add column if not exists personal boolean not null default false;
comment on column public.accounting_documents.personal is 'Personal, not SLSI (Dana, Nov 13): no store, no store question.';
alter table public.autopay_payments add column if not exists policy_id uuid references public.accounting_policies(id) on delete set null;
alter table public.autopay_payments add column if not exists confirmed_email_id uuid references public.emails(id) on delete set null;
alter table public.autopay_payments add column if not exists check_task_id uuid references public.tasks(id) on delete set null;
alter table public.autopay_payments add column if not exists closed_task_at timestamptz;
comment on column public.autopay_payments.confirmed_email_id is 'The payment confirmation email that came after the draft (Dana, Nov 13).';
comment on column public.autopay_payments.check_task_id is 'The "check on the autopay" task made when no confirmation came within 3 business days.';

-- the payments already read belong to their policy through the repeating schedule that matched them
update public.autopay_payments p set policy_id = s.policy_id
  from public.autopay_schedules s
 where p.policy_id is null and s.policy_id is not null and s.organization_id = p.organization_id and p.payee ~* s.payee_match;
update public.autopay_payments p set policy_id = t.policy_id from public.tasks t where p.task_id = t.id and p.policy_id is null and t.policy_id is not null;

-- ---- the bill reader leaves autopay policies to the autopay reader ------------------------------------------------------
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
  -- a policy on autopay: its "scheduled payment reminder" and bills are the autopay reader's (one reminder task, closed on the
  -- date, a check task when no confirmation follows; Dana, Nov 13). Only a past-due notice and a confirmation are read here.
  if pol.autopay and v_kind in ('due_soon', 'bill') then return 'autopay'; end if;
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

-- 5 pm Pacific on a date: the moment a day's autopay is treated as done (so closes carry the payment date, not the sweep's)
create or replace function public.tk_close_time(p_day date) returns timestamptz
language sql immutable as $$ select (p_day::timestamp + time '17:00') at time zone 'America/Los_Angeles' $$;
grant execute on function public.tk_close_time(date) to authenticated, service_role;


-- ---- a payment confirmation closes the autopay tasks and records the payment -----------------------------------------
create or replace function public.autopay_confirmation_seen(p_email uuid) returns integer
language plpgsql security definer set search_path = public as $$
declare e record; p record; n integer := 0; v_tok text; v_t text;
begin
  select em.id, em.organization_id, em.subject, em.from_email, em.body_text, em.received_at, b.kind as box_kind
    into e from public.emails em left join public.mailboxes b on b.id = em.mailbox_id where em.id = p_email;
  if e.id is null or e.box_kind is distinct from 'accounting' then return 0; end if;
  if coalesce(e.subject, '') !~* '(payment (confirmation|received|processed|complete|posted|successful)|thank you for (your )?payment|we (have )?received your payment|your payment (was|has been) (received|processed|applied)|receipt for your payment)' then return 0; end if;
  v_t := regexp_replace(coalesce(e.body_text, ''), '\s+', ' ', 'g');
  for p in
    select * from public.autopay_payments a
     where a.organization_id = e.organization_id and a.automatic and a.confirmed_email_id is null
       and a.pay_on between (e.received_at at time zone 'America/Los_Angeles')::date - 12 and (e.received_at at time zone 'America/Los_Angeles')::date + 2
  loop
    v_tok := lower(split_part(regexp_replace(p.payee, '[^A-Za-z ]', '', 'g'), ' ', 1));
    if v_tok = '' or (coalesce(e.from_email, '') !~* v_tok and coalesce(e.subject, '') !~* v_tok
        and not exists (select 1 from public.accounting_policies pl where pl.id = p.policy_id and pl.policy_number <> '' and position(upper(pl.policy_number) in upper(v_t)) > 0)) then continue; end if;
    update public.autopay_payments set confirmed_email_id = e.id where id = p.id;
    update public.tasks set done_at = e.received_at, closed_how = 'vms', remind_at = null,
           done_note = 'The payment confirmation came in on ' || to_char(e.received_at at time zone 'America/Los_Angeles', 'Mon FMDD, YYYY') || ' ("' || left(coalesce(e.subject, ''), 80) || '"). Click to open it.',
           done_email_id = e.id
     where done_at is null and id in (p.task_id, p.check_task_id);
    if p.policy_id is not null then
      insert into public.accounting_policy_terms (organization_id, policy_id, term_label, paid_on, paid_amount, paid_email_id, notes)
      values (e.organization_id, p.policy_id, public.insurance_term_label(p.policy_id, p.pay_on), p.pay_on, p.amount, e.id,
              'Autopay of ' || coalesce('$' || to_char(p.amount, 'FM999,999,990.00'), 'the premium') || ' on ' || to_char(p.pay_on, 'FMMM/FMDD/YYYY') || ', confirmed by their email of ' || to_char(e.received_at at time zone 'America/Los_Angeles', 'FMMM/FMDD/YYYY') || '.')
      on conflict (policy_id, term_label) do update set paid_on = coalesce(accounting_policy_terms.paid_on, excluded.paid_on),
        paid_amount = coalesce(accounting_policy_terms.paid_amount, excluded.paid_amount), paid_email_id = excluded.paid_email_id,
        notes = case when accounting_policy_terms.notes like '%confirmed by their email%' then accounting_policy_terms.notes else concat_ws(E'\n', nullif(accounting_policy_terms.notes, ''), excluded.notes) end;
    end if;
    n := n + 1;
  end loop;
  return n;
end $$;
revoke execute on function public.autopay_confirmation_seen(uuid) from public, anon, authenticated;
grant execute on function public.autopay_confirmation_seen(uuid) to service_role;

create or replace function public.emails_autopay_confirmed() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.direction = 'in' and new.mailbox_id is not null then perform public.autopay_confirmation_seen(new.id); end if;
  return new;
end $$;
drop trigger if exists emails_autopay_confirmed on public.emails;
create trigger emails_autopay_confirmed after insert on public.emails for each row execute function public.emails_autopay_confirmed();

-- ---- the daily sweep: reminders close on the date, a check task when nothing confirmed the draft --------------------------
create or replace function public.autopay_sweep(p_org uuid default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare t record; p record; s record; v_owner uuid; v_closed integer := 0; v_checks integer := 0; v_confirmed integer := 0; v_when timestamptz; v_amt numeric; v_payee text;
        v_tok text; v_email uuid; v_check uuid; v_due date; v_sched_id uuid;
begin
  -- 1. reminders whose date has come: closed as of the payment date (a back-check keeps the original date)
  for t in
    select tk.* from public.tasks tk
     where tk.done_at is null and (tk.auto_key like 'autopay:%' or tk.auto_key like 'autopay_sched:%')
       and tk.due_date <= (now() at time zone 'America/Los_Angeles')::date and (p_org is null or tk.organization_id = p_org)
  loop
    v_when := public.tk_close_time(t.due_date);
    -- a reminder from the repeating pattern has no payment row yet: make one so the check and the confirmation find it
    if t.auto_key like 'autopay_sched:%' and not exists (select 1 from public.autopay_payments a where a.task_id = t.id) then
      v_sched_id := nullif(split_part(t.auto_key, ':', 2), '')::uuid;
      select * into s from public.autopay_schedules where id = v_sched_id;
      if s.id is not null then
        insert into public.autopay_payments (organization_id, email_id, payee, what, pay_on, amount, automatic, dedupe_key, task_id, policy_id)
        values (t.organization_id, s.last_email_id, s.payee, s.what, t.due_date, s.amount, s.automatic, 'sched:' || t.id, t.id, coalesce(s.policy_id, t.policy_id))
        on conflict (organization_id, dedupe_key) do nothing;
      end if;
    end if;
    update public.tasks set done_at = v_when, closed_how = 'vms', remind_at = null,
           done_note = 'The autopay was due ' || to_char(t.due_date, 'Mon FMDD, YYYY') || '. VMS closes the reminder on the date; when no payment confirmation reaches billing@ within 3 business days, a task to check on it follows.'
     where id = t.id;
    update public.autopay_payments set closed_task_at = v_when where task_id = t.id;
    v_closed := v_closed + 1;
  end loop;

  -- 2. three business days after a draft with no confirmation: a task to check on it (dated when the three days were up)
  for p in
    select a.* from public.autopay_payments a
     where a.automatic and a.confirmed_email_id is null and a.check_task_id is null
       and a.pay_on >= date '2026-11-01' and public.add_business_days((a.pay_on::timestamp + time '17:00') at time zone 'America/Los_Angeles', 3) <= now()
       and (p_org is null or a.organization_id = p_org) and not public.autopay_skip_payee(a.payee)
  loop
    -- a confirmation that came in before this rule existed
    v_tok := lower(split_part(regexp_replace(p.payee, '[^A-Za-z ]', '', 'g'), ' ', 1));
    select em.id into v_email from public.emails em join public.mailboxes b on b.id = em.mailbox_id
     where b.kind = 'accounting' and em.organization_id = p.organization_id and em.direction = 'in'
       and em.received_at between (p.pay_on - 1)::timestamp and (p.pay_on + 12)::timestamp
       and coalesce(em.subject, '') ~* '(payment (confirmation|received|processed|complete|posted|successful)|thank you for (your )?payment|we (have )?received your payment|your payment (was|has been) (received|processed|applied)|receipt for your payment)'
       and v_tok <> '' and (coalesce(em.from_email, '') ~* v_tok or coalesce(em.subject, '') ~* v_tok)
     order by em.received_at limit 1;
    if v_email is not null then
      perform public.autopay_confirmation_seen(v_email);
      v_confirmed := v_confirmed + 1;
      continue;
    end if;
    v_owner := public.accounting_owner(p.organization_id);
    if v_owner is null then continue; end if;
    v_when := public.add_business_days((p.pay_on::timestamp + time '17:00') at time zone 'America/Los_Angeles', 3);
    v_due := (v_when at time zone 'America/Los_Angeles')::date;
    v_payee := p.payee || coalesce(' $' || to_char(p.amount, 'FM999,999,990.00'), '') || coalesce(' (' || nullif(p.what, '') || ')', '');
    insert into public.tasks (organization_id, title, notes, due_date, remind_at, assigned_to, auto_key, area, thread_id, policy_id, created_at)
    values (p.organization_id, left('Check on the autopay that was supposed to draft on ' || to_char(p.pay_on, 'Mon FMDD') || ': ' || v_payee, 200),
            'No payment confirmation reached billing@ within 3 business days of the ' || to_char(p.pay_on, 'Mon FMDD, YYYY') || ' autopay. Check the bank or their account. This closes itself when a confirmation comes in. Click to open the reminder email.',
            v_due, greatest(v_when, now()), v_owner, 'autopay_check:' || p.id, 'accounting',
            (select thread_id from public.emails where id = p.email_id), p.policy_id, v_when)
    on conflict (organization_id, auto_key) where auto_key is not null do nothing
    returning id into v_check;
    if v_check is not null then
      update public.autopay_payments set check_task_id = v_check where id = p.id;
      v_checks := v_checks + 1;
    end if;
  end loop;
  return jsonb_build_object('closed', v_closed, 'checks', v_checks, 'confirmed', v_confirmed);
end $$;
revoke execute on function public.autopay_sweep(uuid) from public, anon, authenticated;
grant execute on function public.autopay_sweep(uuid) to service_role;

-- ---- renewals: VMS closes them unless the premium went up 1% or more -------------------------------------------------------
create or replace function public.accounting_renewal_check(p_org uuid default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare t record; pol public.accounting_policies%rowtype; v_date date; v_months integer; v_new numeric; v_new_on timestamptz; v_new_src text; v_prior numeric; v_pct numeric;
        v_closed integer := 0; v_flagged integer := 0; v_term text; v_paid_on date; v_paid_email uuid; v_next date;
begin
  for t in
    select tk.* from public.tasks tk where tk.done_at is null and tk.auto_key like 'policy_renewal:%' and tk.policy_id is not null and (p_org is null or tk.organization_id = p_org)
  loop
    select * into pol from public.accounting_policies where id = t.policy_id;
    if pol.id is null then continue; end if;
    v_date := nullif(split_part(t.auto_key, ':', 3), '')::date;
    if v_date is null then continue; end if;
    select every_months into v_months from public.autopay_schedules where policy_id = pol.id and is_active order by updated_at desc limit 1;
    v_months := coalesce(v_months, 12);
    v_term := public.insurance_term_label(pol.id, v_date);
    -- the new premium: the term's premium once a paper gave it, else the autopay drafted for the renewal
    select tm.premium, tm.updated_at into v_new, v_new_on from public.accounting_policy_terms tm where tm.policy_id = pol.id and tm.term_label = v_term and tm.premium is not null;
    v_new_src := case when v_new is not null then 'the renewal papers' end;
    v_paid_on := null; v_paid_email := null;
    if v_new is null then
      select a.amount, e.received_at, a.pay_on, a.email_id into v_new, v_new_on, v_paid_on, v_paid_email
        from public.autopay_payments a left join public.emails e on e.id = a.email_id
       where a.policy_id = pol.id and a.automatic and a.amount is not null and a.pay_on between v_date - 15 and v_date + 15
       order by abs(a.pay_on - v_date) limit 1;
      v_new_src := case when v_new is not null then 'the autopay reminder' end;
    end if;
    if v_new is null then continue; end if;
    -- the prior premium: the term before, else the autopay one term earlier
    select tm.premium into v_prior from public.accounting_policy_terms tm where tm.policy_id = pol.id and tm.term_label < v_term and tm.premium is not null order by tm.term_label desc limit 1;
    if v_prior is null then
      select a.amount into v_prior from public.autopay_payments a
       where a.policy_id = pol.id and a.automatic and a.amount is not null and a.pay_on between (v_date - make_interval(months => v_months))::date - 20 and (v_date - make_interval(months => v_months))::date + 20
       order by abs(a.pay_on - (v_date - make_interval(months => v_months))::date) limit 1;
    end if;
    if v_prior is null or v_prior = 0 then
      if t.notes not like '%no earlier premium on file%' then
        update public.tasks set notes = concat_ws(' ', t.notes, 'New premium $' || to_char(v_new, 'FM999,999,990.00') || ' from ' || v_new_src || '; no earlier premium on file to compare, so this stays for you.') where id = t.id;
      end if;
      continue;
    end if;
    v_pct := round((v_new - v_prior) / v_prior * 100, 1);
    if v_pct >= 1 then
      if t.title not like 'Premium up%' then
        update public.tasks set title = left('Premium up ' || v_pct || '% ($' || to_char(v_prior, 'FM999,999,990.00') || ' → $' || to_char(v_new, 'FM999,999,990.00') || '): look before closing the renewal of ' || pol.label, 200),
               notes = concat_ws(' ', t.notes, 'The new premium from ' || v_new_src || ' is $' || to_char(v_new, 'FM999,999,990.00') || ' against $' || to_char(v_prior, 'FM999,999,990.00') || ' last term, up ' || v_pct || '%. Look it over, then close this (Renewed on the policy page).'),
               remind_at = least(coalesce(remind_at, now()), now())
         where id = t.id;
        v_flagged := v_flagged + 1;
      end if;
      continue;
    end if;
    -- the same, lower, or up less than 1%: VMS closes it, dated when the premium became known, and rolls the policy forward
    v_next := (v_date + make_interval(months => v_months))::date;
    insert into public.accounting_policy_terms (organization_id, policy_id, term_label, premium, paid_on, paid_amount, paid_email_id, paid_from, notes)
    values (pol.organization_id, pol.id, v_term, v_new, v_paid_on, case when v_paid_on is not null then v_new end, v_paid_email, case when v_paid_on is not null then 'autopay' else '' end,
            'Premium $' || to_char(v_new, 'FM999,999,990.00') || ' from ' || v_new_src || ' (last term $' || to_char(v_prior, 'FM999,999,990.00') || ', ' || case when v_pct < 0 then 'down ' || abs(v_pct) when v_pct = 0 then 'the same' else 'up ' || v_pct end || case when v_pct <> 0 then '%' else '' end || ').')
    on conflict (policy_id, term_label) do update set premium = coalesce(accounting_policy_terms.premium, excluded.premium),
      paid_on = coalesce(accounting_policy_terms.paid_on, excluded.paid_on), paid_amount = coalesce(accounting_policy_terms.paid_amount, excluded.paid_amount),
      paid_email_id = coalesce(accounting_policy_terms.paid_email_id, excluded.paid_email_id),
      notes = case when accounting_policy_terms.notes like '%from the%' then accounting_policy_terms.notes else concat_ws(E'\n', nullif(accounting_policy_terms.notes, ''), excluded.notes) end;
    update public.accounting_policies set renewal_date = v_next where id = pol.id and renewal_date <= v_date;
    update public.tasks set done_at = coalesce(v_new_on, now()), closed_how = 'vms', remind_at = null, done_email_id = v_paid_email,
           done_note = 'Premium $' || to_char(v_new, 'FM999,999,990.00') || ' (from ' || v_new_src || ') against $' || to_char(v_prior, 'FM999,999,990.00') || ' last term: ' || case when v_pct < 0 then 'down ' || abs(v_pct) || '%' when v_pct = 0 then 'the same' else 'up ' || v_pct || '%, under 1%' end || '. VMS closed this and moved the renewal to ' || to_char(v_next, 'Mon FMDD, YYYY') || '.'
     where id = t.id;
    v_closed := v_closed + 1;
  end loop;
  return jsonb_build_object('closed', v_closed, 'flagged', v_flagged);
end $$;
revoke execute on function public.accounting_renewal_check(uuid) from public, anon, authenticated;
grant execute on function public.accounting_renewal_check(uuid) to service_role;

-- ---- Personal, not SLSI ---------------------------------------------------------------------------------------------------
create or replace function public.accounting_document_personal() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if not new.personal then
    if (new.contact_id is not null and exists (select 1 from public.accounting_contacts c where c.id = new.contact_id and c.personal))
       or (new.policy_id is not null and exists (select 1 from public.accounting_policies p where p.id = new.policy_id and p.personal))
       or (new.party <> '' and exists (select 1 from public.accounting_contacts c where c.organization_id = new.organization_id and c.personal and c.status <> 'ignored' and lower(c.company) = lower(new.party)))
       or (new.number <> '' and exists (select 1 from public.accounting_policies p where p.organization_id = new.organization_id and p.personal
             and (regexp_replace(p.policy_number, '[^A-Za-z0-9]', '', 'g') = regexp_replace(new.number, '[^A-Za-z0-9]', '', 'g') or regexp_replace(new.number, '[^A-Za-z0-9]', '', 'g') = any (select regexp_replace(x, '[^A-Za-z0-9]', '', 'g') from unnest(p.prior_policy_numbers) x))))
    then new.personal := true; end if;
  end if;
  if new.personal then
    new.whose := '';
    -- the only doubt was which business it belongs to: there is none, it is personal
    if new.status = 'review' and (new.question ~* '(which business|what store|which store|belong|bookkeeping|personal|whose policy|store policy|code (it|them|this) to)' or new.claude_note ~* 'personal') then
      new.status := 'filed'; new.sure := true; new.question := ''; new.choices := '[]'::jsonb;
    end if;
  end if;
  return new;
end $$;
drop trigger if exists accounting_documents_personal on public.accounting_documents;
create trigger accounting_documents_personal before insert or update on public.accounting_documents for each row execute function public.accounting_document_personal();

-- a company marked personal: its papers follow (the trigger above does the rest, and keeps each paper's own dates)
create or replace function public.accounting_contact_personal_follow() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.personal and not coalesce(old.personal, false) then
    update public.accounting_documents d set personal = true
     where d.organization_id = new.organization_id and not d.personal and (d.contact_id = new.id or (new.company <> '' and lower(d.party) = lower(new.company)));
  end if;
  return new;
end $$;
drop trigger if exists accounting_contacts_personal_follow on public.accounting_contacts;
create trigger accounting_contacts_personal_follow after insert or update of personal on public.accounting_contacts for each row execute function public.accounting_contact_personal_follow();

-- the back-check, for the counts: every paper is looked at again under the new rule (dates untouched)
create or replace function public.accounting_personal_backcheck(p_org uuid default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_before integer; v_after integer; v_review_before integer; v_review_after integer;
begin
  if auth.uid() is not null and not public.sees_accounting() then raise exception 'Accounting only' using errcode = '42501'; end if;
  select count(*) filter (where personal), count(*) filter (where status = 'review') into v_before, v_review_before from public.accounting_documents where p_org is null or organization_id = p_org;
  update public.accounting_documents d set personal = d.personal
   where (p_org is null or d.organization_id = p_org)
     and (d.status = 'review' or d.category = 'personal_insurance' or d.personal
          or d.contact_id in (select id from public.accounting_contacts where personal)
          or d.policy_id in (select id from public.accounting_policies where personal)
          or lower(d.party) in (select lower(company) from public.accounting_contacts where personal and company <> ''));
  select count(*) filter (where personal), count(*) filter (where status = 'review') into v_after, v_review_after from public.accounting_documents where p_org is null or organization_id = p_org;
  return jsonb_build_object('personal_before', v_before, 'personal_after', v_after, 'review_before', v_review_before, 'review_after', v_review_after);
end $$;
revoke execute on function public.accounting_personal_backcheck(uuid) from public, anon;
grant execute on function public.accounting_personal_backcheck(uuid) to authenticated, service_role;

-- the set_updated_at trigger would stamp today on every re-checked paper: keep each paper's own updated_at through the back-check
create or replace function public.accounting_documents_keep_updated_at() returns trigger
language plpgsql as $$
begin
  if current_setting('vms.backcheck', true) = 'on' then new.updated_at := old.updated_at; end if;
  return new;
end $$;
drop trigger if exists zz_accounting_documents_keep_updated_at on public.accounting_documents;
create trigger zz_accounting_documents_keep_updated_at before update on public.accounting_documents for each row execute function public.accounting_documents_keep_updated_at();

-- a paper whose "what" has a slash in it ("Dwelling renewal 5/8/2025-5/8/2026") could not be re-named (the file name may not
-- hold a slash): the rename keeps the facts and writes the slash as a dash
create or replace function public.accounting_documents_rename() returns trigger
language plpgsql as $$
declare v_ext text;
begin
  if tg_op = 'UPDATE' and new.file_name is distinct from old.file_name then return new; end if;
  if tg_op = 'UPDATE' and (new.doc_date, new.whose, new.party, new.number, new.what, new.amount, new.status_word)
       is not distinct from (old.doc_date, old.whose, old.party, old.number, old.what, old.amount, old.status_word) then return new; end if;
  v_ext := nullif(regexp_replace(new.file_name, '^.*\.([A-Za-z0-9]{1,5})$', '\1'), new.file_name);
  if new.doc_date is not null and new.party <> '' then
    new.file_name := replace(public.accounting_document_name(new.doc_date, new.whose, new.party, new.number, new.what, new.amount, new.status_word, v_ext), '/', '-');
  end if;
  return new;
end;
$$;

-- ---- data: Drive is Progressive; personal companies; the three Progressive tasks; the back-checks ---------------------------
do $$
declare v_drive uuid; v_prog uuid; v_pol uuid; r jsonb; v_n integer;
begin
  -- companies under Personal insurance are personal (Progressive, Drive, Goosehead, Cal Fair for the houses, Bamboo, Steadily)
  update public.accounting_contacts set personal = true where category = 'personal_insurance' and not personal;

  select id into v_drive from public.accounting_contacts where company = 'Driveinsurance' and merged_into is null limit 1;
  select id into v_prog from public.accounting_contacts where company = 'Progressive' and merged_into is null limit 1;
  if v_drive is not null and v_prog is not null then
    update public.accounting_contact_addresses set contact_id = v_prog where contact_id = v_drive;
    update public.accounting_contacts c set message_count = c.message_count + f.message_count, last_contact_at = greatest(c.last_contact_at, f.last_contact_at),
           notes = concat_ws(E'\n', nullif(c.notes, ''), 'Also Drive Insurance (the same company; customerservice@driveinsurance.com). The two cards were merged Nov 13, 2026.' , nullif(f.notes, ''))
      from public.accounting_contacts f where c.id = v_prog and f.id = v_drive;
    update public.accounting_contacts set status = 'ignored', merged_into = v_prog where id = v_drive;
    update public.email_threads set accounting_contact_id = v_prog where accounting_contact_id = v_drive;
    update public.accounting_documents set party = 'Progressive', contact_id = v_prog where party in ('Drive', 'Drive Insurance') or contact_id = v_drive;
  end if;
  update public.accounting_policies set label = 'Personal auto (Progressive)', carrier = 'Progressive (Drive Insurance)' where policy_number = '963278000' and personal;

  -- the "Pay …" task the bill reader made from an autopay reminder, and any other open bill task on an autopay policy: made by mistake
  update public.tasks t set done_at = t.created_at, closed_how = 'mistake', remind_at = null,
         done_note = 'Made by mistake: the email was a scheduled-payment reminder for a policy on autopay, not a bill to pay (rule fixed Nov 13).'
    from public.accounting_policies p
   where t.policy_id = p.id and p.autopay and t.auto_key like 'policy_bill:%' and t.done_at is null;

  -- the autopay reminders whose date has passed close as of their date, and the checks that are owed get made; renewals judged
  r := public.autopay_sweep();
  raise notice 'autopay sweep: %', r;
  r := public.accounting_renewal_check();
  raise notice 'renewal check: %', r;
  perform set_config('vms.backcheck', 'on', true);
  r := public.accounting_personal_backcheck();
  perform set_config('vms.backcheck', 'off', true);
  raise notice 'personal back-check: %', r;
end $$;

-- ---- crons ------------------------------------------------------------------------------------------------------------------
do $$ begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule(jobid) from cron.job where jobname in ('autopay-sweep', 'accounting-renewal-check');
    perform cron.schedule('autopay-sweep', '25 13 * * *', $job$select public.autopay_sweep()$job$);
    perform cron.schedule('accounting-renewal-check', '35 13 * * *', $job$select public.accounting_renewal_check()$job$);
  end if;
end $$;
