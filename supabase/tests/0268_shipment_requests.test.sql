-- 0268: a confirmed order makes a shipment request to the confirmation's sender (cc shipping contact and rep); the email
-- wording per kind; the form answers become a freight quote and Trevor's task; a "free" reply confirms the terms; a
-- "charged" reply hands it to the buyer with Trevor cc'd; 3 business days with nothing back makes the follow-up.
do $$
declare v_org uuid := '00000000-0000-0000-0000-000000000001'; v_vendor uuid; v_rg uuid; v_thread uuid; v_email uuid; v_order uuid; v_req uuid; v_link uuid; v_tok uuid; v_q uuid; r record; v_n int; v_task uuid; v_buyer uuid := '11111111-1111-1111-1111-111111111111'; v_trevor uuid := '33333333-3333-3333-3333-333333333333'; v_email2 uuid;
begin
  update public.profiles set is_active = true, handles_logistics = true where id = v_trevor;
  insert into public.rep_groups (organization_id, name) values (v_org, 'TEST REPS 0268') returning id into v_rg;
  insert into public.rep_group_contacts (organization_id, rep_group_id, name, email) values (v_org, v_rg, 'Rita Rep', 'rita@reps.example');
  insert into public.vendors (organization_id, name, rep_group_id) values (v_org, 'TEST SHIP VENDOR 0268', v_rg) returning id into v_vendor;
  insert into public.vendor_emails (organization_id, vendor_id, email, contact_name, contact_type, roles, source) values (v_org, v_vendor, 'ship@vendor.example', 'Sam Ship', 'shipping', array['shipping']::public.contact_type[], 'manual');
  insert into public.email_threads (organization_id, gmail_thread_id, subject, last_message_at, vendor_id) values (v_org, 't0268', 'Order Confirmation 5551', now(), v_vendor) returning id into v_thread;
  insert into public.emails (organization_id, thread_id, gmail_id, direction, from_email, from_name, to_emails, subject, received_at, body_text, vendor_id)
    values (v_org, v_thread, 'm0268-1', 'in', 'orders@vendor.example', 'Pat Orders', '{orders@shaverlakesports.com}', 'Order Confirmation 5551', now() - interval '1 hour', 'Confirmed.', v_vendor) returning id into v_email;
  insert into public.orders (organization_id, vendor_id, status, po_number, source, placed_by_id, free_shipping) values (v_org, v_vendor, 'awaiting_confirmation', 'T268', 'manual', v_buyer, false) returning id into v_order;
  insert into public.vendor_links (organization_id, vendor_id, kind, label, storage_path, received_at, order_id, email_id, doc_number) values (v_org, v_vendor, 'confirmation', 'Conf 5551', 'x/0268.pdf', current_date, v_order, v_email, 'SO5551');

  -- confirmed → a 'details' request to the sender, cc shipping + rep
  update public.orders set status = 'confirmed' where id = v_order;
  select * into r from public.shipment_requests where order_id = v_order;
  if r.id is null then raise exception 'no request'; end if;
  if r.kind <> 'details' or r.status <> 'ready' then raise exception 'kind/status wrong: % %', r.kind, r.status; end if;
  if r.to_emails <> array['orders@vendor.example'] then raise exception 'to wrong: %', r.to_emails; end if;
  if not ('ship@vendor.example' = any (r.cc_emails)) or not ('rita@reps.example' = any (r.cc_emails)) then raise exception 'cc wrong: %', r.cc_emails; end if;
  if r.send_as <> v_trevor then raise exception 'not sent as Trevor'; end if;
  v_req := r.id; v_tok := r.token;
  select * into r from public.shipment_request_email(v_req);
  if r.subject not like 'Shipment details and freight quote for our PO T268 (your order SO5551)' then raise exception 'subject wrong: %', r.subject; end if;
  if r.body not like '%including backorders%' or r.body not like '%/ship/' || v_tok || '%' or r.body not like 'Hi Pat,%' then raise exception 'body wrong'; end if;

  -- sent: follow-up due in 3 business days
  insert into public.emails (organization_id, thread_id, gmail_id, direction, from_email, to_emails, subject, received_at, body_text, vendor_id)
    values (v_org, v_thread, 'm0268-2', 'out', 'orders@shaverlakesports.com', '{orders@vendor.example}', 'Shipment details and freight quote for our PO T268', now(), 'the email', v_vendor) returning id into v_email2;
  perform public.shipment_request_sent(v_req, v_email2);
  select * into r from public.shipment_requests where id = v_req;
  if r.status <> 'sent' or r.followup_due_at is null or r.thread_id <> v_thread then raise exception 'sent state wrong'; end if;
  if (select ship_email_sent_at from public.orders where id = v_order) is null then raise exception 'shipping email not stamped on the order'; end if;
  -- Fri Oct 30 10:00 Pacific + 3 business days = Wed Nov 4 10:00 Pacific
  if (public.add_business_days(timestamptz '2026-10-30 17:00+00', 3) at time zone 'America/Los_Angeles') <> timestamp '2026-11-04 10:00' then raise exception 'business days wrong: %', public.add_business_days(timestamptz '2026-10-30 17:00+00', 3); end if;

  -- the form: opened, then answered → a freight quote and Trevor's task; the shipping contact learned
  if (public.shipment_form_get(v_tok))->>'po' <> 'T268' then raise exception 'form get wrong'; end if;
  if (select status from public.shipment_requests where id = v_req) <> 'opened' then raise exception 'not opened'; end if;
  perform public.shipment_form_submit(v_tok, 'pallet', jsonb_build_object('company', 'Vendor Co', 'address', '1 Dock St', 'city', 'Reno', 'state', 'NV', 'zip', '89501', 'contact_name', 'Dee Dock', 'contact_email', 'dee@vendor.example', 'contact_phone', '555-0100', 'hours', 'M-F 8-3', 'ready_date', '2026-11-05', 'services', jsonb_build_array('liftgate'),
    'items', jsonb_build_array(jsonb_build_object('count', 2, 'weight', 400, 'length', 48, 'width', 40, 'height', 60, 'stackable', false, 'hazmat', false, 'description', 'coolers')), 'quote_amount', '312.50', 'notes', ''));
  select * into r from public.shipment_requests where id = v_req;
  if r.status <> 'answered' or r.answered_how <> 'form' or r.method <> 'pallet' or r.quote_id is null then raise exception 'answer state wrong'; end if;
  select * into r from public.freight_quotes where id = r.quote_id;
  if r.vendor_cost <> 312.50 or r.ships_by <> 'pallet' or (r.details->>'total_weight')::numeric <> 800 or r.email_id is not null or r.task_id is null then raise exception 'quote wrong'; end if;
  if (select title from public.tasks where id = r.task_id) not like 'Get freight quote: TEST SHIP VENDOR 0268, PO T268 – Pallet, P1' then raise exception 'quote task wrong'; end if;
  if not exists (select 1 from public.vendor_emails where vendor_id = v_vendor and email = 'dee@vendor.example' and contact_type = 'shipping') then raise exception 'shipping contact not learned'; end if;
  delete from public.shipment_requests where id = v_req;
  delete from public.freight_quotes where order_id = v_order;
  delete from public.tasks where order_id = v_order;

  -- free freight agreed, not on the confirmation → free_check; "yes, free" confirms it
  update public.orders set status = 'awaiting_confirmation', freight_terms = 'free' where id = v_order;
  update public.orders set status = 'confirmed' where id = v_order;
  select * into r from public.shipment_requests where order_id = v_order;
  if r.kind <> 'free_check' then raise exception 'free_check expected, got %', r.kind; end if;
  select * into r from public.shipment_request_email(r.id);
  if r.body not like '%understanding we would receive free shipping%' or r.body like '%/ship/%' then raise exception 'free_check wording wrong'; end if;
  select id into v_req from public.shipment_requests where order_id = v_order;
  perform public.shipment_request_sent(v_req, v_email2);
  perform public.shipment_request_reply(v_req, v_email, '{"answer":"free","note":"ships free"}'::jsonb);
  if (select status from public.shipment_requests where id = v_req) <> 'confirmed' then raise exception 'free reply not confirmed'; end if;
  if (select freight_terms_confirmed_how from public.orders where id = v_order) <> 'reply' then raise exception 'terms not confirmed on the order'; end if;
  delete from public.shipment_requests where id = v_req;

  -- half agreed → half_check; "charged" → the buyer's task, Trevor's FYI, the conversation to the buyer
  update public.orders set status = 'awaiting_confirmation', freight_terms = 'half', freight_terms_confirmed_at = null, freight_terms_confirmed_how = null where id = v_order;
  update public.orders set status = 'confirmed' where id = v_order;
  select id into v_req from public.shipment_requests where order_id = v_order;
  select * into r from public.shipment_request_email(v_req);
  if r.body not like '%cover half of the freight%' or r.body not like '%/ship/%' then raise exception 'half wording wrong'; end if;
  perform public.shipment_request_sent(v_req, v_email2);
  if public.shipment_request_reply(v_req, v_email, '{"answer":"charged"}'::jsonb) <> 'disputed' then raise exception 'not disputed'; end if;
  select id into v_task from public.tasks where auto_key = 'shipdispute:' || v_req;
  if (select assigned_to from public.tasks where id = v_task) <> v_buyer then raise exception 'dispute task not the buyer''s'; end if;
  if not exists (select 1 from public.tasks where auto_key = 'shipdispute_cc:' || v_req and assigned_to = v_trevor) then raise exception 'no FYI for Trevor'; end if;
  if (select owner_id from public.email_threads where id = v_thread) <> v_buyer then raise exception 'conversation not the buyer''s'; end if;
  update public.tasks set done_at = now(), done_by = v_buyer where id = v_task;
  if (select done_at from public.tasks where auto_key = 'shipdispute_cc:' || v_req) is null then raise exception 'FYI not closed with the buyer''s task'; end if;
  delete from public.tasks where order_id = v_order;
  delete from public.shipment_requests where id = v_req;

  -- nothing back in 3 business days → Trevor's task with the follow-up draft
  update public.orders set status = 'awaiting_confirmation', freight_terms = 'charged' where id = v_order;
  update public.orders set status = 'confirmed' where id = v_order;
  select id into v_req from public.shipment_requests where order_id = v_order;
  perform public.shipment_request_sent(v_req, v_email2);
  update public.shipment_requests set followup_due_at = now() - interval '1 minute', sent_at = now() - interval '4 days' where id = v_req;
  if public.shipment_request_followups(v_org) < 1 then raise exception 'no follow-up made'; end if;
  select * into r from public.shipment_requests where id = v_req;
  if r.followup_task_id is null or r.followup_draft_id is null then raise exception 'follow-up pieces missing'; end if;
  if (select body from public.email_drafts where id = r.followup_draft_id) like '%easier%' then raise exception 'draft has the dropped line'; end if;
  if (select draft_id from public.tasks where id = r.followup_task_id) <> r.followup_draft_id then raise exception 'task not linked to the draft'; end if;
  -- Trevor sends the follow-up: the task stays open (the vendor has not answered), the draft is just gone from it
  perform public.mail_command_sent(r.followup_draft_id, v_email2, v_trevor);
  if (select done_at from public.tasks where id = r.followup_task_id) is not null then raise exception 'sending the follow-up closed the task'; end if;
  if (select draft_id from public.tasks where id = r.followup_task_id) is not null then raise exception 'draft still on the task'; end if;
  -- the form answered afterwards closes the task and removes the draft
  perform public.shipment_form_submit(r.token, 'parcel', jsonb_build_object('items', jsonb_build_array(jsonb_build_object('count', 3, 'weight', 20)), 'quote_amount', '45'));
  if (select done_at from public.tasks where id = r.followup_task_id) is null then raise exception 'follow-up task not closed'; end if;
  if (select title from public.tasks where auto_key = 'freight_quote:' || (select quote_id from public.shipment_requests where id = v_req)) not like '%Parcel, WWEX/UPS' then raise exception 'parcel task wrong'; end if;

  -- a web-order vendor never gets one
  update public.vendors set web_orders = true where id = v_vendor;
  delete from public.shipment_requests where id = v_req;
  update public.orders set status = 'awaiting_confirmation' where id = v_order;
  update public.orders set status = 'confirmed' where id = v_order;
  if exists (select 1 from public.shipment_requests where order_id = v_order) then raise exception 'web-order vendor got a request'; end if;

  delete from public.freight_quotes where order_id = v_order;
  delete from public.tasks where order_id = v_order or vendor_id = v_vendor;
  delete from public.email_drafts where order_id = v_order;
  delete from public.vendor_links where vendor_id = v_vendor;
  delete from public.orders where id = v_order;
  delete from public.emails where thread_id = v_thread;
  delete from public.email_threads where id = v_thread;
  delete from public.vendor_emails where vendor_id = v_vendor;
  delete from public.vendors where id = v_vendor;
  delete from public.rep_group_contacts where rep_group_id = v_rg;
  delete from public.rep_groups where id = v_rg;
end $$;
