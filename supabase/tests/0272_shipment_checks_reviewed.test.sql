-- 0272: a free-freight check waits in Trevor's Drafts with a task; the tick on the order clears it; sending the draft sends it.
do $$
declare v_org uuid := '00000000-0000-0000-0000-000000000001'; v_vendor uuid; v_thread uuid; v_email uuid; v_order uuid; s record; v_trevor uuid := '33333333-3333-3333-3333-333333333333'; v_out uuid;
begin
  update public.profiles set is_active = true, handles_logistics = true where id = v_trevor;
  insert into public.vendors (organization_id, name) values (v_org, 'TEST CHECK VENDOR 0269') returning id into v_vendor;
  insert into public.email_threads (organization_id, gmail_thread_id, subject, last_message_at, vendor_id) values (v_org, 't0269', 'Order 77', now(), v_vendor) returning id into v_thread;
  insert into public.emails (organization_id, thread_id, gmail_id, direction, from_email, from_name, to_emails, subject, received_at, body_text, vendor_id)
    values (v_org, v_thread, 'm0269-1', 'in', 'sales@v269.example', 'Lee', '{orders@shaverlakesports.com}', 'Order 77', now() - interval '1 hour', 'Confirmed.', v_vendor) returning id into v_email;
  insert into public.orders (organization_id, vendor_id, status, po_number, source, free_shipping, freight_terms) values (v_org, v_vendor, 'awaiting_confirmation', 'T269', 'manual', true, 'free') returning id into v_order;
  insert into public.vendor_links (organization_id, vendor_id, kind, label, storage_path, received_at, order_id, email_id) values (v_org, v_vendor, 'confirmation', 'Conf 77', 'x/0269.pdf', current_date, v_order, v_email);
  update public.orders set status = 'confirmed' where id = v_order;
  select * into s from public.shipment_requests where order_id = v_order;
  if s.kind <> 'free_check' or s.status <> 'ready' or not s.hold or s.review_task_id is null or s.review_draft_id is null then raise exception 'check not held for Trevor: % % % %', s.kind, s.status, s.hold, s.review_task_id; end if;
  if (select assigned_to from public.tasks where id = s.review_task_id) <> v_trevor then raise exception 'task not Trevor''s'; end if;
  if (select body from public.email_drafts where id = s.review_draft_id) not like '%understanding we would receive free shipping%' then raise exception 'draft wording wrong'; end if;
  -- the tick on the order: settled, draft gone, task closed, nothing sent
  update public.orders set freight_terms_confirmed_at = now(), freight_terms_confirmed_how = 'person' where id = v_order;
  if (select status from public.shipment_requests where id = s.id) <> 'confirmed' then raise exception 'tick did not settle the check'; end if;
  if exists (select 1 from public.email_drafts where id = s.review_draft_id) then raise exception 'draft not removed'; end if;
  if (select done_at from public.tasks where id = s.review_task_id) is null then raise exception 'task not closed'; end if;
  -- again, this time Trevor sends the draft
  delete from public.shipment_requests where id = s.id;
  delete from public.tasks where order_id = v_order;
  update public.orders set status = 'awaiting_confirmation', freight_terms_confirmed_at = null, freight_terms_confirmed_how = null where id = v_order;
  update public.orders set status = 'confirmed' where id = v_order;
  select * into s from public.shipment_requests where order_id = v_order;
  insert into public.emails (organization_id, thread_id, gmail_id, direction, from_email, to_emails, subject, received_at, body_text, vendor_id)
    values (v_org, v_thread, 'm0269-2', 'out', 'orders@shaverlakesports.com', '{sales@v269.example}', 'Freight on our PO T269', now(), 'the check', v_vendor) returning id into v_out;
  perform public.mail_command_sent(s.review_draft_id, v_out, v_trevor);
  if (select status from public.shipment_requests where id = s.id) <> 'sent' or (select followup_due_at from public.shipment_requests where id = s.id) is null then raise exception 'sending the draft did not send the request'; end if;
  if (select done_at from public.tasks where id = s.review_task_id) is null or (select closed_how from public.tasks where id = s.review_task_id) <> 'person' then raise exception 'check task not closed by the send'; end if;
  delete from public.shipment_requests where order_id = v_order;
  delete from public.tasks where order_id = v_order;
  delete from public.email_drafts where order_id = v_order;
  delete from public.vendor_links where vendor_id = v_vendor;
  delete from public.orders where id = v_order;
  delete from public.emails where thread_id = v_thread;
  delete from public.email_threads where id = v_thread;
  delete from public.vendors where id = v_vendor;
end $$;
