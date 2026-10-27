-- 0256: a credit request from our email → a task for the signer with a 7-day reminder; the follow-up draft; the credit paper
-- marks it Received; the Edenred credit tags the paper On Edenred and closes the task; a credit with no request gets the tag.
do $$
declare v_org uuid := '00000000-0000-0000-0000-000000000001'; v_vendor uuid; v_thread uuid; v_email uuid; v_req uuid; v_task uuid; v_draft uuid; v_link uuid; v_wwd uuid; v_trevor uuid; v_other uuid; v_link2 uuid; v_n int;
begin
  -- the Trevor from 0001 (a first name in the signature finds him)
  v_trevor := '33333333-3333-3333-3333-333333333333';
  update public.profiles set is_active = true where id = v_trevor;
  insert into public.vendors (organization_id, name) values (v_org, 'TEST CREDIT VENDOR 0255') returning id into v_vendor;
  insert into public.vendor_billing_routes (organization_id, vendor_id, route, is_default) values (v_org, v_vendor, 'worldwide', true);
  insert into public.email_threads (organization_id, gmail_thread_id, subject, last_message_at, vendor_id) values (v_org, 't0255', 'Missing items Invoice 803803', now(), v_vendor) returning id into v_thread;
  insert into public.emails (organization_id, thread_id, gmail_id, direction, from_email, to_emails, subject, received_at, body_text, vendor_id)
    values (v_org, v_thread, 'm0255-1', 'out', 'orders@example.com', '{rep@vendor.example}', 'Missing items Invoice 803803', now() - interval '8 days', 'Two cases were short. Please credit us. Thanks, Trevor', v_vendor) returning id into v_email;

  -- the request and the task
  v_req := public.credit_request_make(v_email, 'two cases short', '803803', 48.50, 'Trevor');
  if v_req is null then raise exception 'no request'; end if;
  if public.credit_request_make(v_email, 'again', null, null, null) <> v_req then raise exception 'request made twice'; end if;
  select task_id into v_task from public.credit_requests where id = v_req;
  if v_task is null then raise exception 'no task'; end if;
  if (select assigned_to from public.tasks where id = v_task) <> v_trevor then raise exception 'task not Trevor''s'; end if;
  if (select remind_rule from public.tasks where id = v_task) <> 'credit' then raise exception 'remind rule wrong'; end if;
  if (select remind_at from public.tasks where id = v_task) > now() then raise exception 'reminder should be due (sent 8 days ago)'; end if;

  -- the follow-up draft with the reminder, once
  v_draft := public.credit_request_followup(v_task);
  if v_draft is null then raise exception 'no draft'; end if;
  if public.credit_request_followup(v_task) <> v_draft then raise exception 'draft made twice'; end if;
  if (select subject from public.email_drafts where id = v_draft) <> 'Re: Missing items Invoice 803803' then raise exception 'draft subject wrong'; end if;
  if (select body from public.email_drafts where id = v_draft) not like '%invoice 803803%' then raise exception 'draft body lacks the invoice'; end if;

  -- the credit paper lands in the same conversation: Received, reminders stop, the draft goes, task waits for Edenred
  insert into public.vendor_links (organization_id, vendor_id, kind, label, storage_path, file_name, received_at, doc_number, doc_total, source)
    values (v_org, v_vendor, 'credit', 'Credit CM1001', 'x/0255.pdf', 'cm1001.pdf', current_date, 'CM1001', 48.50, 'email') returning id into v_link;
  if (select status from public.credit_requests where id = v_req) <> 'received' then raise exception 'not received'; end if;
  if (select credit_link_id from public.credit_requests where id = v_req) <> v_link then raise exception 'link not tied'; end if;
  if (select done_at from public.tasks where id = v_task) is not null then raise exception 'WWD task closed too early'; end if;
  if (select remind_at from public.tasks where id = v_task) is not null then raise exception 'still reminding'; end if;
  if exists (select 1 from public.email_drafts where id = v_draft) then raise exception 'draft not removed'; end if;

  -- Edenred shows the credit (Trevor's upload): On Edenred on the paper, the task closes with a plain note
  insert into public.wwd_invoices (organization_id, seq, kind, vendor_id, vendor_invoice_number, amount, posted_date, sources)
    values (v_org, 'E0255', 'credit', v_vendor, 'CM1001', -48.50, date '2026-10-20', '{edenred}') returning id into v_wwd;
  if (select on_edenred_on from public.vendor_links where id = v_link) <> date '2026-10-20' then raise exception 'paper not tagged On Edenred'; end if;
  if (select status from public.credit_requests where id = v_req) <> 'on_edenred' then raise exception 'request not on edenred'; end if;
  if (select closed_how from public.tasks where id = v_task) <> 'vms' or (select done_note from public.tasks where id = v_task) not like '%on Edenred%' then raise exception 'task not closed by VMS'; end if;

  -- a credit with no request: the tag, no task
  select count(*) into v_n from public.tasks where vendor_id = v_vendor and done_at is null;
  insert into public.vendor_links (organization_id, vendor_id, kind, label, storage_path, file_name, received_at, doc_number, doc_total, source)
    values (v_org, v_vendor, 'credit', 'Credit CM2002', 'x/0255b.pdf', 'cm2002.pdf', current_date, 'CM2002', 10, 'email') returning id into v_link2;
  insert into public.wwd_invoices (organization_id, seq, kind, vendor_id, vendor_invoice_number, amount, posted_date, sources)
    values (v_org, 'E0255b', 'credit', v_vendor, 'CM2002', -10, date '2026-10-21', '{edenred}');
  if (select on_edenred_on from public.vendor_links where id = v_link2) <> date '2026-10-21' then raise exception 'lone credit not tagged'; end if;
  if (select count(*) from public.tasks where vendor_id = v_vendor and done_at is null) <> v_n then raise exception 'lone credit made a task'; end if;

  -- the queue lists outgoing vendor mail not yet read
  insert into public.emails (organization_id, thread_id, gmail_id, direction, from_email, to_emails, subject, received_at, body_text, vendor_id)
    values (v_org, v_thread, 'm0255-2', 'out', 'orders@example.com', '{rep@vendor.example}', 'Re: Missing items', now(), 'Thanks', v_vendor);
  if (select count(*) from public.mail_credit_queue(v_org, 50) q where q.email_id in (select id from public.emails where gmail_id like 'm0255-%')) <> 2 then raise exception 'queue wrong'; end if;

  delete from public.wwd_invoices where vendor_id = v_vendor;
  delete from public.credit_requests where vendor_id = v_vendor;
  delete from public.tasks where vendor_id = v_vendor;
  delete from public.vendor_links where vendor_id = v_vendor;
  delete from public.emails where thread_id = v_thread;
  delete from public.email_threads where id = v_thread;
  delete from public.vendors where id = v_vendor;
end $$;
