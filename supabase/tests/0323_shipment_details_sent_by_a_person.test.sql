-- 0323: the shipment details email waits in Trevor's Drafts with his task; nothing goes until he sends it.
do $$
declare v_org uuid := '00000000-0000-0000-0000-000000000001'; v_vendor uuid; v_thread uuid; v_email uuid; v_order uuid; s record; v_trevor uuid := '33333333-3333-3333-3333-333333333333'; v_out uuid; t record;
begin
  update public.profiles set is_active = true, handles_logistics = true where id = v_trevor;
  insert into public.vendors (organization_id, name) values (v_org, 'TEST DETAILS VENDOR 0323') returning id into v_vendor;
  insert into public.email_threads (organization_id, gmail_thread_id, subject, last_message_at, vendor_id) values (v_org, 't0323', 'Order 88', now(), v_vendor) returning id into v_thread;
  insert into public.emails (organization_id, thread_id, gmail_id, direction, from_email, from_name, to_emails, subject, received_at, body_text, vendor_id)
    values (v_org, v_thread, 'm0323-1', 'in', 'sales@v323.example', 'Lee', '{orders@shaverlakesports.com}', 'Order 88', now() - interval '1 hour', 'Confirmed.', v_vendor) returning id into v_email;
  insert into public.orders (organization_id, vendor_id, status, po_number, source, free_shipping, freight_terms) values (v_org, v_vendor, 'awaiting_confirmation', 'T323', 'manual', false, 'charged') returning id into v_order;
  insert into public.emails (organization_id, thread_id, gmail_id, direction, from_email, to_emails, subject, received_at, body_text, vendor_id, order_id) values (v_org, v_thread, 'ord-0323-1', 'out', 'orders@shaverlakesports.com', '{sales@v323.example}', 'Our order', now() - interval '3 days', 'Our order.', v_vendor, v_order); -- 0365: the freight email goes to whoever we ordered with
  insert into public.vendor_links (organization_id, vendor_id, kind, label, storage_path, received_at, order_id, email_id) values (v_org, v_vendor, 'confirmation', 'Conf 88', 'x/0323.pdf', current_date, v_order, v_email);
  update public.orders set status = 'confirmed' where id = v_order;
  select * into s from public.shipment_requests where order_id = v_order;
  if s.kind <> 'details' or s.status <> 'ready' or not s.hold or s.review_task_id is null or s.review_draft_id is null then raise exception 'details request not held for a person: % % % %', s.kind, s.status, s.hold, s.review_task_id; end if;
  select * into t from public.tasks where id = s.review_task_id;
  if t.auto_key <> 'shipsend:' || s.id or t.draft_id <> s.review_draft_id or t.title not like 'Send the freight email: TEST DETAILS VENDOR 0323, PO T323%' then raise exception 'task wrong: % %', t.auto_key, t.title; end if;
  if (select owner_id from public.email_drafts where id = s.review_draft_id) <> s.send_as then raise exception 'draft not in the sender''s Drafts'; end if;
  -- the person sends it: the request is sent, the clock starts, the task closes as theirs
  insert into public.emails (organization_id, thread_id, gmail_id, direction, from_email, to_emails, subject, received_at, body_text, vendor_id)
    values (v_org, v_thread, 'm0323-2', 'out', 'orders@shaverlakesports.com', '{sales@v323.example}', 'Shipment details for PO T323', now(), 'the details', v_vendor) returning id into v_out;
  perform public.mail_command_sent(s.review_draft_id, v_out, v_trevor);
  if (select status from public.shipment_requests where id = s.id) <> 'sent' or (select followup_due_at from public.shipment_requests where id = s.id) is null then raise exception 'sending the draft did not send the request'; end if;
  select * into t from public.tasks where id = s.review_task_id;
  if t.done_at is null or t.closed_how <> 'person' or t.done_note <> 'Sent the vendor the freight email.' then raise exception 'task not closed by the send: % %', t.closed_how, t.done_note; end if;
  delete from public.shipment_requests where order_id = v_order;
  delete from public.tasks where order_id = v_order;
  delete from public.email_drafts where order_id = v_order;
  delete from public.vendor_links where vendor_id = v_vendor;
  delete from public.orders where id = v_order;
  delete from public.emails where thread_id = v_thread;
  delete from public.email_threads where id = v_thread;
  delete from public.vendors where id = v_vendor;
end $$;
select 'ok' as shipment_details_wait_for_a_person;
