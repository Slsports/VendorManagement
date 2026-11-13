-- 0368 — The IRS and the FTB: no confirmation by the due date means a task at once (Dana, Nov 13: "IRS and FTB send immediate
-- payment confirmations so Those should notify me immediately if they were not made by the date due to give me time to make
-- them if the payment didnt go to avoid fines"). On file: IRS Direct Pay ("Confirmation of Scheduled Transaction") and FTB
-- Web Pay ("Web Pay Payment Scheduled") email the moment a payment is scheduled or made, days ahead, and nothing follows. So
-- for a tax payment the confirmation can come up to 45 days before the date, and the check task is made at the start of the
-- due date, not three business days after. The sweep now runs hourly so the task comes early on the day. Insurers and the
-- bank keep the 3-business-day rule.
set local lock_timeout = '5s';

create or replace function public.autopay_is_tax(p_payee text) returns boolean
language sql immutable as $$ select coalesce(p_payee, '') ~* '^(irs|internal revenue|ftb|franchise tax|california franchise|cdtfa|edd)\M' $$;
grant execute on function public.autopay_is_tax(text) to authenticated, service_role;

-- ---- a payment confirmation closes the autopay tasks and records the payment -----------------------------------------
create or replace function public.autopay_confirmation_seen(p_email uuid) returns integer
language plpgsql security definer set search_path = public as $$
declare e record; p record; n integer := 0; v_tok text; v_t text;
begin
  select em.id, em.organization_id, em.subject, em.from_email, em.body_text, em.received_at, b.kind as box_kind
    into e from public.emails em left join public.mailboxes b on b.id = em.mailbox_id where em.id = p_email;
  if e.id is null or e.box_kind is distinct from 'accounting' then return 0; end if;
  if coalesce(e.subject, '') !~* '(payment (confirmation|received|processed|complete|posted|successful)|thank you for (your )?payment|we (have )?received your payment|your payment (was|has been) (received|processed|applied)|receipt for your payment|direct pay confirmation|web pay payment (scheduled|received|confirmation))' then return 0; end if;
  v_t := regexp_replace(coalesce(e.body_text, ''), '\s+', ' ', 'g');
  for p in
    select * from public.autopay_payments a
     where a.organization_id = e.organization_id and (a.automatic or public.autopay_is_tax(a.payee)) and a.confirmed_email_id is null
       and a.pay_on between (e.received_at at time zone 'America/Los_Angeles')::date - 12
                        and (e.received_at at time zone 'America/Los_Angeles')::date + case when public.autopay_is_tax(a.payee) then 45 else 2 end
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

  -- 2. a draft with no confirmation: a task to check on it. Three business days after the date for an insurer or a bank;
  --    for the IRS and the FTB (Dana, Nov 13: "send immediate payment confirmations … notify me immediately if they were not
  --    made by the date due to give me time to make them") the start of the due date itself, so there is time to pay that day.
  for p in
    select a.* from public.autopay_payments a
     where (a.automatic or public.autopay_is_tax(a.payee)) and a.confirmed_email_id is null and a.check_task_id is null
       and a.pay_on >= date '2026-11-01'
       and case when public.autopay_is_tax(a.payee) then a.pay_on <= (now() at time zone 'America/Los_Angeles')::date
                else public.add_business_days((a.pay_on::timestamp + time '17:00') at time zone 'America/Los_Angeles', 3) <= now() end
       and (p_org is null or a.organization_id = p_org) and not public.autopay_skip_payee(a.payee)
  loop
    -- a confirmation that came in before this rule existed
    v_tok := lower(split_part(regexp_replace(p.payee, '[^A-Za-z ]', '', 'g'), ' ', 1));
    select em.id into v_email from public.emails em join public.mailboxes b on b.id = em.mailbox_id
     where b.kind = 'accounting' and em.organization_id = p.organization_id and em.direction = 'in'
       and em.received_at between (p.pay_on - case when public.autopay_is_tax(p.payee) then 45 else 1 end)::timestamp and (p.pay_on + 12)::timestamp
       and coalesce(em.subject, '') ~* '(payment (confirmation|received|processed|complete|posted|successful)|thank you for (your )?payment|we (have )?received your payment|your payment (was|has been) (received|processed|applied)|receipt for your payment|direct pay confirmation|web pay payment (scheduled|received|confirmation))'
       and v_tok <> '' and (coalesce(em.from_email, '') ~* v_tok or coalesce(em.subject, '') ~* v_tok)
     order by em.received_at desc limit 1;
    if v_email is not null then
      perform public.autopay_confirmation_seen(v_email);
      v_confirmed := v_confirmed + 1;
      continue;
    end if;
    v_owner := public.accounting_owner(p.organization_id);
    if v_owner is null then continue; end if;
    v_payee := p.payee || coalesce(' $' || to_char(p.amount, 'FM999,999,990.00'), '') || coalesce(' (' || nullif(p.what, '') || ')', '');
    if public.autopay_is_tax(p.payee) then
      v_when := (p.pay_on::timestamp + time '00:00') at time zone 'America/Los_Angeles';
      v_due := p.pay_on;
      insert into public.tasks (organization_id, title, notes, due_date, remind_at, assigned_to, auto_key, area, thread_id, policy_id, created_at)
      values (p.organization_id, left(v_payee || ' is due ' || to_char(p.pay_on, 'Mon FMDD') || ': no payment confirmation on file, make it today if it was not made', 200),
              'The IRS (Direct Pay) and the FTB (Web Pay) email a confirmation the moment a payment is scheduled or made, and none for this payment has reached billing@. Make the payment today if it has not been made, so there is no penalty. This closes itself when the confirmation comes in. Click to open the email the payment came from.',
              v_due, now(), v_owner, 'autopay_check:' || p.id, 'accounting',
              (select thread_id from public.emails where id = p.email_id), p.policy_id, greatest(v_when, (select created_at from public.autopay_payments where id = p.id)))
      on conflict (organization_id, auto_key) where auto_key is not null do nothing
      returning id into v_check;
    else
      v_when := public.add_business_days((p.pay_on::timestamp + time '17:00') at time zone 'America/Los_Angeles', 3);
      v_due := (v_when at time zone 'America/Los_Angeles')::date;
      insert into public.tasks (organization_id, title, notes, due_date, remind_at, assigned_to, auto_key, area, thread_id, policy_id, created_at)
      values (p.organization_id, left('Check on the autopay that was supposed to draft on ' || to_char(p.pay_on, 'Mon FMDD') || ': ' || v_payee, 200),
              'No payment confirmation reached billing@ within 3 business days of the ' || to_char(p.pay_on, 'Mon FMDD, YYYY') || ' autopay. Check the bank or their account. This closes itself when a confirmation comes in. Click to open the reminder email.',
              v_due, greatest(v_when, now()), v_owner, 'autopay_check:' || p.id, 'accounting',
              (select thread_id from public.emails where id = p.email_id), p.policy_id, v_when)
      on conflict (organization_id, auto_key) where auto_key is not null do nothing
      returning id into v_check;
    end if;
    if v_check is not null then
      update public.autopay_payments set check_task_id = v_check where id = p.id;
      v_checks := v_checks + 1;
    end if;
  end loop;
  return jsonb_build_object('closed', v_closed, 'checks', v_checks, 'confirmed', v_confirmed);
end $$;
revoke execute on function public.autopay_sweep(uuid) from public, anon, authenticated;
grant execute on function public.autopay_sweep(uuid) to service_role;


-- the check tasks for the IRS and FTB payments that are now due come from the sweep as it runs; nothing past is reopened
do $$ begin perform public.autopay_sweep(); end $$;

do $$ begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule(jobid) from cron.job where jobname = 'autopay-sweep';
    perform cron.schedule('autopay-sweep', '25 * * * *', $job$select public.autopay_sweep()$job$);
  end if;
end $$;
