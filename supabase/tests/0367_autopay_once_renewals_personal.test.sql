\set ON_ERROR_STOP on
\pset footer off
\echo '>>> 0367: autopay once and closed on the date, a check when nothing confirms; renewals judged by the premium; personal papers'
reset role;
select set_config('request.jwt.claims', '', false) is not null as service;
select id as admin_id from public.profiles where organization_id = '00000000-0000-0000-0000-000000000001' and role = 'admin' and is_active order by created_at limit 1 \gset
update public.profiles set sees_accounting = true where id = :'admin_id';
insert into public.mailboxes (organization_id, kind, address, label, owner_id, gmail_box, auto_share_vendor_mail)
values ('00000000-0000-0000-0000-000000000001', 'accounting', 'billing-0367@example.com', 'Billing', :'admin_id', 'billing-0367@example.com', false) returning id as mb \gset

do $$
declare v_org uuid := '00000000-0000-0000-0000-000000000001'; mb uuid; pol uuid; th uuid; e1 uuid; e2 uuid; e3 uuid; t record; p record; r jsonb; d uuid; c uuid; pay uuid;
begin
  select id into mb from public.mailboxes where gmail_box = 'billing-0367@example.com';
  -- a personal policy on autopay renewing every 6 months
  insert into public.accounting_policies (organization_id, label, carrier, policy_number, renewal_date, autopay, personal, is_active)
  values (v_org, 'Personal auto 0367', 'Progressive 0367', '963270367', current_date - 2, true, true, true) returning id into pol;
  insert into public.autopay_schedules (organization_id, payee, what, payee_match, every_months, next_on, amount, policy_id) values (v_org, 'Drive 0367', 'auto', 'drive 0367', 6, current_date - 2, 3015.64, pol);
  insert into public.email_threads (organization_id, gmail_thread_id, subject, last_message_at, mailbox_id) values (v_org, 't0367', 'Drive 0367 scheduled payment reminder', now(), mb) returning id into th;
  -- the reminder email 5 days before: the bill reader makes no "Pay" task for an autopay policy
  insert into public.emails (organization_id, thread_id, gmail_id, direction, from_email, to_emails, subject, received_at, body_text, mailbox_id)
  values (v_org, th, 'm0367-1', 'in', 'customerservice@drive0367.com', '{billing-0367@example.com}', 'Drive 0367 scheduled payment reminder', now() - interval '7 days', 'Policy Number: 963270367 Payment Date: ' || to_char(current_date - 2, 'MM/DD/YYYY') || ' Amount: $2842.64', mb) returning id into e1;
  if exists (select 1 from public.tasks where policy_id = pol and auto_key like 'policy_bill:%') then raise exception 'an autopay reminder made a Pay task'; end if;
  -- the autopay reader's reminder task and payment (what autopay_apply writes)
  insert into public.tasks (organization_id, title, notes, due_date, remind_at, assigned_to, auto_key, area, thread_id, policy_id)
  values (v_org, 'Autopay: Drive 0367 $2,842.64', 'x', current_date - 2, now(), (select public.accounting_owner(v_org)), 'autopay:test0367', 'accounting', th, pol) returning id into d;
  insert into public.autopay_payments (organization_id, email_id, payee, what, pay_on, amount, automatic, dedupe_key, task_id, policy_id)
  values (v_org, e1, 'Drive 0367', 'auto', current_date - 2, 2842.64, true, 'drive0367:now', d, pol) returning id into pay;
  -- the earlier term's autopay, six months ago
  insert into public.autopay_payments (organization_id, payee, what, pay_on, amount, automatic, dedupe_key, policy_id)
  values (v_org, 'Drive 0367', 'auto', current_date - 2 - 182, 3015.64, true, 'drive0367:prior', pol);
  -- the renewal task the tracker made
  insert into public.tasks (organization_id, title, notes, due_date, remind_at, assigned_to, auto_key, area, policy_id)
  values (v_org, 'Renewal: Personal auto 0367', 'x', current_date - 2, now(), (select public.accounting_owner(v_org)), 'policy_renewal:' || pol || ':' || (current_date - 2), 'accounting', pol);

  -- the sweep: the reminder closes dated 5 pm on the payment date; no confirmation within 3 business days → the check task, dated then
  r := public.autopay_sweep(v_org);
  select * into t from public.tasks where id = d;
  if t.done_at is null or t.closed_how <> 'vms' or (t.done_at at time zone 'America/Los_Angeles')::date <> current_date - 2 then raise exception 'reminder not closed on its date: %', t.done_at; end if;
  if public.add_business_days(((current_date - 2)::timestamp + time '17:00') at time zone 'America/Los_Angeles', 3) <= now() then
    select * into t from public.tasks where auto_key = 'autopay_check:' || pay;
    if t.id is null then raise exception 'no check task'; end if;
    if t.title not like 'Check on the autopay that was supposed to draft on%' then raise exception 'check title: %', t.title; end if;
    if t.created_at > now() - interval '1 minute' then raise exception 'check task dated now, not when the 3 days were up'; end if;
    -- their confirmation arrives: the check closes, dated by the email, and the payment is on the policy years
    insert into public.emails (organization_id, thread_id, gmail_id, direction, from_email, to_emails, subject, received_at, body_text, mailbox_id)
    values (v_org, th, 'm0367-2', 'in', 'customerservice@drive0367.com', '{billing-0367@example.com}', 'Drive 0367 payment confirmation', now() - interval '1 hour', 'Policy Number: 963270367 payment of $2842.64', mb) returning id into e2;
    select * into t from public.tasks where auto_key = 'autopay_check:' || pay;
    if t.done_at is null or t.done_email_id <> e2 then raise exception 'confirmation did not close the check'; end if;
    if (select confirmed_email_id from public.autopay_payments where id = pay) <> e2 then raise exception 'payment not marked confirmed'; end if;
  end if;

  -- the renewal: $2,842.64 against $3,015.64 is lower → closed by VMS, dated when the premium was known, renewal moved 6 months
  r := public.accounting_renewal_check(v_org);
  select * into t from public.tasks where auto_key like 'policy_renewal:' || pol || ':%';
  if t.done_at is null or t.closed_how <> 'vms' then raise exception 'renewal not closed: %', r; end if;
  if t.done_at > now() - interval '6 days' then raise exception 'renewal close dated today, not the reminder: %', t.done_at; end if;
  if (select renewal_date from public.accounting_policies where id = pol) <> (current_date - 2 + interval '6 months')::date then raise exception 'renewal date not moved'; end if;
  if not exists (select 1 from public.accounting_policy_terms where policy_id = pol and premium = 2842.64) then raise exception 'term not recorded'; end if;

  -- up 1% or more: the task stays, retitled
  insert into public.accounting_policies (organization_id, label, carrier, policy_number, renewal_date, autopay, is_active)
  values (v_org, 'Store policy 0367', 'Markel 0367', 'MK0367', current_date, true, true) returning id into pol;
  insert into public.accounting_policy_terms (organization_id, policy_id, term_label, premium) values (v_org, pol, public.insurance_term_label(pol, current_date - 365), 1000);
  insert into public.accounting_policy_terms (organization_id, policy_id, term_label, premium) values (v_org, pol, public.insurance_term_label(pol, current_date), 1010);
  insert into public.tasks (organization_id, title, notes, due_date, remind_at, assigned_to, auto_key, area, policy_id)
  values (v_org, 'Renewal: Store policy 0367', 'x', current_date, now(), (select public.accounting_owner(v_org)), 'policy_renewal:' || pol || ':' || current_date, 'accounting', pol);
  r := public.accounting_renewal_check(v_org);
  select * into t from public.tasks where auto_key like 'policy_renewal:' || pol || ':%';
  if t.done_at is not null or t.title not like 'Premium up 1%' then raise exception 'a 1%% rise should keep the task: % / %', t.title, t.done_at; end if;

  -- Personal, not SLSI: a paper for a personal company files with no store and no store question
  insert into public.accounting_contacts (organization_id, company, category, personal) values (v_org, 'Goosehead 0367', 'personal_insurance', true) returning id into c;
  insert into public.accounting_documents (organization_id, category, party, doc_year, file_name, kind, whose, storage_path, size, sha256, source, original_name, status, sure, question, choices)
  values (v_org, 'insurance', 'Goosehead 0367', 2026, '2026-01-01 SLS Goosehead 0367 policy.pdf', 'policy', 'SLS', 'x/0367.pdf', 1, 'sha0367', 'upload', 'a.pdf', 'review', false, 'Which business does this Goosehead policy cover?', '[{"label":"SLS"},{"label":"P&S"}]')
  returning id into d;
  select * into p from public.accounting_documents where id = d;
  if not p.personal or p.whose <> '' or p.status <> 'filed' or p.question <> '' then raise exception 'personal paper not filed: % % % %', p.personal, p.whose, p.status, p.question; end if;
  -- marking a company personal later carries its papers along
  insert into public.accounting_contacts (organization_id, company, category) values (v_org, 'Bamboo 0367', 'insurance') returning id into c;
  insert into public.accounting_documents (organization_id, category, party, doc_year, file_name, kind, whose, storage_path, size, sha256, source, original_name, status, sure)
  values (v_org, 'insurance', 'Bamboo 0367', 2026, 'b.pdf', 'policy', 'SLS', 'x/0367b.pdf', 1, 'sha0367b', 'upload', 'b.pdf', 'filed', true) returning id into d;
  update public.accounting_contacts set personal = true where id = c;
  if not (select personal and whose = '' from public.accounting_documents where id = d) then raise exception 'company mark did not follow to its paper'; end if;
  raise exception 'ok-rollback';
exception when others then
  if sqlerrm <> 'ok-rollback' then raise; end if;
end $$;
