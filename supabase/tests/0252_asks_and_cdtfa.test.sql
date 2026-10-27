-- 0252: next-reminder rhythm, a paperwork ask becomes a task and closes on a reply with attachments, the CDTFA month task and its confirmations.
do $$
declare v_org uuid := '00000000-0000-0000-0000-000000000001'; v_thread uuid; v_email uuid; v_task uuid; v_next timestamptz; v_cd uuid; v_pay uuid; v_file uuid; v_r text;
begin
  -- rhythm: a week on, unless 3 days before or the day comes first
  v_next := public.task_next_remind(date '2026-11-20', timestamptz '2026-11-01 17:00+00');
  if v_next::date <> date '2026-11-08' then raise exception 'weekly expected, got %', v_next; end if;
  v_next := public.task_next_remind(date '2026-11-20', timestamptz '2026-11-15 17:00+00');
  if (v_next at time zone 'America/Los_Angeles')::date <> date '2026-11-17' then raise exception '3 days before expected, got %', v_next; end if;
  v_next := public.task_next_remind(date '2026-11-20', timestamptz '2026-11-17 17:00+00');
  if (v_next at time zone 'America/Los_Angeles')::date <> date '2026-11-20' then raise exception 'the day expected, got %', v_next; end if;
  v_next := public.task_next_remind(null, timestamptz '2026-11-01 17:00+00');
  if v_next::date <> date '2026-11-08' then raise exception 'weekly with no due date expected'; end if;

  -- an ask becomes a task, once; a reply with attachments closes it
  insert into public.email_threads (organization_id, gmail_thread_id, subject, last_message_at) values (v_org, 't0252', 'Vendor Registration', now()) returning id into v_thread;
  insert into public.emails (organization_id, thread_id, gmail_id, direction, from_email, from_name, to_emails, subject, received_at, body_text)
    values (v_org, v_thread, 'm0252-1', 'in', 'monica@parks.example', 'Monica Perez', '{billing@example.com}', 'Vendor Registration', now(), 'Please complete and return the forms by 11/15.') returning id into v_email;
  v_task := public.task_from_ask(v_email, 'the Sno-Park registration forms', date '2026-11-15');
  if v_task is null then raise exception 'no ask task'; end if;
  if public.task_from_ask(v_email, 'again', null) <> v_task then raise exception 'ask task made twice'; end if;
  if (select remind_rule from public.tasks where id = v_task) <> 'ask' or (select due_date from public.tasks where id = v_task) <> date '2026-11-15' then raise exception 'ask task fields wrong'; end if;
  insert into public.emails (organization_id, thread_id, gmail_id, direction, from_email, to_emails, subject, received_at, has_attachments)
    values (v_org, v_thread, 'm0252-2', 'out', 'billing@example.com', '{monica@parks.example}', 'Re: Vendor Registration', now(), true);
  if (select done_at from public.tasks where id = v_task) is null or (select closed_how from public.tasks where id = v_task) <> 'vms' then raise exception 'ask task not closed by the reply'; end if;

  -- CDTFA: February makes January's prepayment due Feb 24; April makes the Q1 return and payment due Apr 30
  v_cd := public.cdtfa_make_tasks(v_org, date '2027-02-05');
  if (select due_date from public.tasks where id = v_cd) <> date '2027-02-24' or (select title from public.tasks where id = v_cd) not like 'CDTFA prepayment for January 2027' then raise exception 'Feb task wrong: %', (select title || ' ' || due_date from public.tasks where id = v_cd); end if;
  if public.cdtfa_make_tasks(v_org, date '2027-02-20') <> v_cd then raise exception 'month task made twice'; end if;
  v_cd := public.cdtfa_make_tasks(v_org, date '2027-04-01');
  if (select due_date from public.tasks where id = v_cd) <> date '2027-04-30' or (select title from public.tasks where id = v_cd) <> 'CDTFA Q1 2027 sales tax return and payment' then raise exception 'Apr task wrong'; end if;
  -- the payment alone does not close the quarter task; the filing too does
  insert into public.emails (organization_id, thread_id, gmail_id, direction, from_email, to_emails, subject, received_at, body_text)
    values (v_org, v_thread, 'm0252-3', 'in', 'noreply@cdtfa.ca.gov', '{billing@example.com}', 'Payment Confirmation', now(), 'Your payment for your Sales and Use Tax account was submitted on 4/28/2027 at 07:28:50 PM and your confirmation number is 0-061-000-001.') returning id into v_pay;
  if (select done_at from public.tasks where id = v_cd) is not null then raise exception 'quarter task closed on payment alone'; end if;
  insert into public.emails (organization_id, thread_id, gmail_id, direction, from_email, to_emails, subject, received_at, body_text)
    values (v_org, v_thread, 'm0252-4', 'in', 'noreply@cdtfa.ca.gov', '{billing@example.com}', 'Filing Confirmation', now(), 'Your Sales & Use Tax Return for filing period 31-Mar-2027 has been submitted on 4/28/2027 at 07:28:04 PM and your filing confirmation number is: 0-061-000-002') returning id into v_file;
  if (select done_at from public.tasks where id = v_cd) is null or (select done_note from public.tasks where id = v_cd) not like 'CDTFA confirmed%' then raise exception 'quarter task not closed on payment and filing: %', (select done_note from public.tasks where id = v_cd); end if;
  -- a prepayment closes on its payment alone
  v_cd := public.cdtfa_make_tasks(v_org, date '2027-03-01');
  insert into public.emails (organization_id, thread_id, gmail_id, direction, from_email, to_emails, subject, received_at, body_text)
    values (v_org, v_thread, 'm0252-5', 'in', 'noreply@cdtfa.ca.gov', '{billing@example.com}', 'Payment Confirmation', now(), 'Your payment for your Sales and Use Tax account was submitted on 3/20/2027 at 07:28:50 PM and your confirmation number is 0-061-000-003.');
  if (select done_at from public.tasks where id = v_cd) is null then raise exception 'prepayment not closed on its payment'; end if;

  delete from public.tasks where auto_key like 'cdtfa:2027-%' or auto_key = 'ask:' || v_email;
  delete from public.email_threads where id = v_thread;
end $$;
