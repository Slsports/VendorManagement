-- 0323 — The shipment details email is sent by Trevor, never by VMS (Dana, Nov 9: "No emails go to vendors without one of
-- my team pressing send. They should be drafts." … "shipment details request should be sent by trevor, not automatic. The
-- reminders can be sent automatically.")
--   • Every shipment request (the details kind too, not only the freight checks of 0272) waits in Trevor's Drafts with his
--     task "Send the shipment details email: <vendor>, PO <po>". Sending it (from Drafts, or Send now) starts the
--     3-business-day clock as before and closes the task. The scheduler no longer sends anything (shipment-requests).
--   • Freight-difference drafts (0322) no longer carry the order: a draft with an order is the order's shipping email, so
--     sending one stamped "shipping email sent" on the order and a new routing letter was attached to it.
--   • Back-check: the one request waiting (Planet Cotton PO 26569, held since Oct 30) goes to Trevor's Drafts the same way.
set local lock_timeout = '5s';

create or replace function public.shipment_request_review(p_req uuid) returns uuid language plpgsql security definer set search_path = public as $$
declare s public.shipment_requests%rowtype; o public.orders%rowtype; v_name text; m record; v_draft uuid; v_task uuid; v_terms text; v_po text; v_details boolean;
begin
  select * into s from public.shipment_requests where id = p_req;
  if s.id is null or s.status <> 'ready' or s.review_task_id is not null then return null; end if;
  select * into o from public.orders where id = s.order_id;
  select name into v_name from public.vendors where id = s.vendor_id;
  v_details := s.kind = 'details';
  -- nobody to send as: the person who placed the order, else the admin
  if s.send_as is null then
    update public.shipment_requests set send_as = coalesce(o.placed_by_id, public.org_admin(s.organization_id)) where id = s.id returning * into s;
    if s.send_as is null then return null; end if;
  end if;
  select * into m from public.shipment_request_email(s.id);
  v_terms := public.order_freight_terms(o);
  v_po := coalesce(nullif(trim(o.po_number), ''), '');
  if cardinality(s.to_emails) > 0 then
    insert into public.email_drafts (organization_id, owner_id, created_by, to_emails, cc_emails, subject, body, thread_id, reply_to_email_id, vendor_id, order_id, attach_routing_letter, note)
    values (s.organization_id, s.send_as, s.send_as, s.to_emails, s.cc_emails, m.subject, m.body, m.thread_id, s.reply_to_email_id, s.vendor_id, s.order_id, m.attach_routing_letter,
            case when v_details then 'Shipment details for ' || coalesce(v_name, 'the vendor') || ', PO ' || v_po || ': VMS wrote it; it goes only when you press Send (Dana, Nov 9)'
                 else 'Freight check for ' || coalesce(v_name, 'the vendor') || ', PO ' || v_po || ': send only if the confirmation does not show the agreed terms (VMS, Oct 31)' end)
    returning id into v_draft;
  end if;
  if v_details then
    insert into public.tasks (organization_id, title, notes, due_date, remind_at, assigned_to, created_by, vendor_id, order_id, thread_id, draft_id, auto_key)
    values (s.organization_id, left('Send the shipment details email: ' || coalesce(v_name, 'the vendor') || ', PO ' || v_po, 200),
            'The order is confirmed. The email asking ' || coalesce(v_name, 'the vendor') || ' for the shipment details (with the form link) is written and waiting in your Drafts (Go to it). Check it and press Send; VMS never sends it on its own. After it goes, VMS waits 3 business days for their answer.'
              || case when cardinality(s.to_emails) = 0 then ' No email on file for this vendor yet: add one on the vendor page first.' else '' end,
            public.next_business_day(now()), now(), s.send_as, s.send_as, s.vendor_id, s.order_id, m.thread_id, v_draft, 'shipsend:' || s.id)
    on conflict (organization_id, auto_key) where auto_key is not null do nothing returning id into v_task;
  else
    insert into public.tasks (organization_id, title, notes, due_date, remind_at, assigned_to, created_by, vendor_id, order_id, thread_id, draft_id, auto_key)
    values (s.organization_id, left('Check freight on the confirmation: ' || coalesce(v_name, 'the vendor') || ', PO ' || v_po, 200),
            'It looks like the confirmation does not say who pays freight. We agreed ' || case v_terms when 'free' then 'free freight' when 'half' then 'they cover half' else 'freight capped at ' || coalesce(o.freight_cap_pct::text, '?') || '%' end
              || '. Open the confirmation on the order. If the terms are there, click "The confirmation shows the agreed terms" in the order''s Shipping box and this task closes. If not, the email asking them is ready in your Drafts (Go to it): send it as is or change it.'
              || case when cardinality(s.to_emails) = 0 then ' No email on file for this vendor yet: add one on the vendor page first.' else '' end,
            public.next_business_day(now()), now(), s.send_as, s.send_as, s.vendor_id, s.order_id, m.thread_id, v_draft, 'shipcheck:' || s.id)
    on conflict (organization_id, auto_key) where auto_key is not null do nothing returning id into v_task;
  end if;
  update public.shipment_requests set hold = true, review_task_id = v_task, review_draft_id = v_draft where id = s.id;
  return v_task;
end $$;
revoke execute on function public.shipment_request_review(uuid) from public, anon, authenticated;
grant execute on function public.shipment_request_review(uuid) to service_role;

-- every request made from now on waits for a person
create or replace function public.shipment_requests_review_new() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'ready' then perform public.shipment_request_review(new.id); end if;
  return null;
end $$;

-- sent (from Drafts or Send now): the clock starts, the draft goes, the task closes with what went
create or replace function public.shipment_request_sent(p_req uuid, p_email uuid) returns void language plpgsql security definer set search_path = public as $$
declare s public.shipment_requests%rowtype; v_thread uuid;
begin
  select * into s from public.shipment_requests where id = p_req;
  if s.id is null then return; end if;
  select e.thread_id into v_thread from public.emails e where e.id = p_email;
  update public.shipment_requests set status = 'sent', sent_email_id = p_email, thread_id = v_thread, sent_at = now(), hold = false,
         followup_due_at = public.add_business_days(now(), 3), last_reply_read_at = now(), review_draft_id = null where id = p_req;
  delete from public.email_drafts where id = s.review_draft_id and gmail_draft_id is null;
  update public.tasks set done_at = now(), closed_how = 'vms', thread_id = coalesce(v_thread, thread_id), draft_id = null,
         done_note = case when s.kind = 'details' then 'The shipment details email went to the vendor.' else 'The freight check email went to the vendor.' end
   where id = s.review_task_id and done_at is null;
  perform public.order_ship_email_sent(s.order_id, p_email);
  update public.emails set order_id = coalesce(order_id, s.order_id) where id = p_email;
end $$;
revoke execute on function public.shipment_request_sent(uuid, uuid) from public, anon, authenticated;
grant execute on function public.shipment_request_sent(uuid, uuid) to service_role;

create or replace function public.mail_command_sent(p_draft uuid, p_email uuid, p_by uuid) returns void
language plpgsql security definer set search_path = public as $$
declare t public.tasks%rowtype; e public.emails%rowtype; a public.po_asks%rowtype;
begin
  select * into e from public.emails where id = p_email;
  -- a freight difference (Dana, Nov 7): the email went; the task waits for their answer
  if public.freight_issue_sent(p_draft, p_email) then return; end if;
  update public.po_asks set status = 'asked', asked_at = coalesce(e.received_at, now()), ask_email_id = p_email,
         thread_id = e.thread_id, read_until = coalesce(e.received_at, now()), draft_id = null
   where draft_id = p_draft and status = 'drafted' returning * into a;
  if a.id is not null then
    perform public.po_ask_log(a, 'po_asked', jsonb_build_object('email_id', p_email, 'thread_id', e.thread_id, 'by', p_by,
      'note', case a.kind when 'add' then format('Asked them to add our PO %s', a.our_po) else format('Asked them to use our PO %s instead of %s and send an updated confirmation', a.our_po, a.their_po) end));
  end if;
  select * into t from public.tasks where draft_id = p_draft limit 1;
  if not found then return; end if;
  if t.auto_key like 'shipreq:%' or t.auto_key like 'credit_req:%' then
    update public.tasks set draft_id = null, thread_id = coalesce(e.thread_id, thread_id),
           notes = coalesce(notes, '') || E'\n\nFollow-up sent on ' || to_char(coalesce(e.received_at, now()) at time zone 'America/Los_Angeles', 'Mon FMDD') || '.'
     where id = t.id;
    if t.auto_key like 'shipreq:%' then perform public.shipment_request_followup_sent(p_draft, p_email); end if;
    return;
  end if;
  if t.auto_key like 'shipcheck:%' or t.auto_key like 'shipsend:%' then
    perform public.shipment_request_sent(split_part(t.auto_key, ':', 2)::uuid, p_email);
    update public.shipment_requests set review_draft_id = null where review_draft_id = p_draft;
    update public.tasks set done_at = now(), done_by = p_by, closed_how = 'person', done_note = case when t.auto_key like 'shipsend:%' then 'Sent the vendor the shipment details email.' else 'Sent the vendor the freight check email.' end, thread_id = coalesce(e.thread_id, thread_id), draft_id = null where id = t.id;
    return;
  end if;
  update public.tasks set done_at = coalesce(done_at, now()), done_by = coalesce(done_by, p_by), done_note = coalesce(done_note, 'Email sent'),
         thread_id = coalesce(e.thread_id, thread_id), draft_id = null
   where id = t.id;
  if t.auto_key like 'vmscmd:%' and e.thread_id is not null then
    update public.mail_commands set watch_thread_ids = array(select distinct x from unnest(watch_thread_ids || e.thread_id) x), watched_at = coalesce(watched_at, now())
     where id = split_part(t.auto_key, ':', 2)::uuid;
  end if;
end;
$$;

-- freight-difference drafts are not the order's shipping email
create or replace function public.freight_issue_check(p_check uuid) returns uuid
language plpgsql security definer set search_path = public as $$
declare c public.order_checks%rowtype; o public.orders%rowtype; v public.vendors%rowtype; i public.freight_issues%rowtype;
  v_fr numeric; v_sub numeric; v_terms text; v_kind text; v_exp numeric; v_text text; v_src uuid; v_quote numeric;
  v_who uuid; v_first text; v_rcpt record; v_draft uuid; v_task uuid; v_inv_email public.emails%rowtype; v_po text; v_id uuid; v_date date;
begin
  select * into c from public.order_checks where id = p_check;
  if c.id is null or c.kind <> 'invoice' or c.reading is null or c.vendor_id is null or c.status in ('not_paperwork', 'dismissed') then return null; end if;
  select * into i from public.freight_issues where check_id = c.id;
  v_fr := case when coalesce(c.reading->>'freight', '') ~ '^-?[0-9]+(\.[0-9]+)?$' then (c.reading->>'freight')::numeric end;
  v_sub := case when coalesce(c.reading->>'subtotal', '') ~ '^-?[0-9]+(\.[0-9]+)?$' then (c.reading->>'subtotal')::numeric end;
  select * into v from public.vendors where id = c.vendor_id;
  if c.order_id is not null then select * into o from public.orders where id = c.order_id; end if;
  v_date := coalesce(c.doc_date, case when coalesce(c.reading->>'doc_date', '') ~ '^\d{4}-\d{2}-\d{2}$' then (c.reading->>'doc_date')::date end, c.created_at::date);
  if coalesce(v_fr, 0) > 0.5 then
    v_terms := case when o.id is null then null
                    when o.freight_terms is not null then o.freight_terms
                    when o.free_shipping then 'free'
                    when o.free_shipping is null and o.freight_notes ~* '^\s*free' then 'free' end;
    select q.approved_cost into v_quote from public.freight_quotes q where q.order_id = o.id and q.status = 'approved' and q.approved_choice = 'vendor' order by q.approved_at desc limit 1;
    v_quote := coalesce(v_quote, o.freight_quote_amount);
    v_src := case when o.freight_terms_source = 'email' then o.freight_terms_source_email_id end;
    if v_terms = 'free' then
      v_kind := 'free_order'; v_exp := 0;
      v_text := case when v_src is not null then 'This order was to ship free; you confirmed free freight by email on '
                       || to_char((select received_at from public.emails where id = v_src) at time zone 'America/Los_Angeles', 'FMMM/FMDD/YY')
                     when o.freight_terms_source = 'summary' and o.free_shipping is null then 'This order was placed with free freight (our order sheet says "' || left(o.freight_notes, 40) || '")'
                     else 'This order was placed with free freight' end;
    elsif o.free_over is not null and v_sub is not null and v_sub >= o.free_over then
      v_kind := 'free_over'; v_exp := 0;
      v_text := 'Freight on this order was to be free over ' || public.money_text(o.free_over) || ', and the order is ' || public.money_text(v_sub);
    elsif v_terms = 'capped' and o.freight_cap_pct is not null and v_sub is not null and v_fr > round(o.freight_cap_pct / 100 * v_sub, 2) + 1 then
      v_kind := 'over_cap'; v_exp := round(o.freight_cap_pct / 100 * v_sub, 2);
      v_text := 'Freight on this order was capped at ' || trim(to_char(o.freight_cap_pct, 'FM990.##')) || '% of the order (' || public.money_text(v_exp) || ')';
    elsif v_quote is not null and v_fr > v_quote + 1 then
      v_kind := 'over_quote'; v_exp := v_quote;
      v_text := 'The freight quoted for this order was ' || public.money_text(v_quote);
    elsif v_terms is null and v.free_shipping_policy = 'always' then
      v_kind := 'vendor_always'; v_exp := 0;
      v_text := 'Your terms with us are free freight';
    elsif v_terms is null and v.free_shipping_policy in ('sometimes', 'always') and v.free_shipping_threshold is not null and v_sub is not null and v_sub >= v.free_shipping_threshold then
      v_kind := 'vendor_minimum'; v_exp := 0;
      v_text := 'Your terms are free freight on orders over ' || public.money_text(v.free_shipping_threshold) || ', and this order is ' || public.money_text(v_sub);
    end if;
  end if;

  if v_kind is null then
    -- the charge is right now (terms changed): drop it, but only before anything went to the vendor
    if i.id is not null and i.status = 'open' then
      update public.freight_issues set status = 'dropped', closed_note = 'The order''s freight terms now allow this charge.' where id = i.id;
      update public.tasks set done_at = now(), closed_how = 'vms', draft_id = null,
             done_note = 'VMS closed it: the order''s freight terms now allow the ' || public.money_text(i.charged) || ' freight on invoice ' || coalesce(i.invoice_number, '') || '.'
       where id = i.task_id and done_at is null;
      delete from public.email_drafts where id = i.draft_id and gmail_draft_id is null;
    end if;
    return null;
  end if;
  if i.id is not null then
    if i.status = 'open' then update public.freight_issues set kind = v_kind, charged = v_fr, expected = v_exp, expected_text = v_text, source_email_id = v_src where id = i.id; end if;
    return i.id;
  end if;

  -- a new one: the email to the vendor and the task
  insert into public.freight_issues (organization_id, check_id, vendor_id, order_id, document_id, invoice_number, invoice_date, kind, charged, expected, expected_text, source_email_id)
    values (c.organization_id, c.id, c.vendor_id, c.order_id, c.document_id, c.doc_number, v_date, v_kind, v_fr, v_exp, v_text, v_src)
    returning id into v_id;
  v_who := coalesce(o.placed_by_id, public.logistics_person(c.organization_id), public.org_admin(c.organization_id));
  select split_part(full_name, ' ', 1) into v_first from public.profiles where id = v_who;
  select * into v_rcpt from public.freight_issue_recipients(c.vendor_id, c.order_id);
  select * into v_inv_email from public.emails where id = c.email_id;
  v_po := coalesce(nullif(trim(o.po_number), ''), nullif(trim(c.po_number), ''));
  insert into public.email_drafts (organization_id, owner_id, created_by, to_emails, cc_emails, subject, body, vendor_id, order_id, note, vendor_link_ids)
    values (c.organization_id, v_who, v_who, coalesce(v_rcpt.to_emails, '{}'), coalesce(v_rcpt.cc_emails, '{}'),
            'Freight on invoice ' || coalesce(c.doc_number, '') || case when v_po is not null then ' (PO ' || v_po || ')' else '' end,
            'Hi,' || E'\n\n' || 'Your invoice ' || coalesce(c.doc_number, '') || ' dated ' || to_char(v_date, 'FMMM/FMDD/YY')
            || case when v_po is not null then ' for PO ' || v_po else '' end || ' charges ' || public.money_text(v_fr) || ' freight. '
            || v_text || '.' || E'\n\n'
            || case when v_exp = 0 then 'Could you send us a credit for the ' || public.money_text(v_fr) || ' freight'
                    else 'Could you send us a credit for the ' || public.money_text(v_fr - v_exp) || ' difference' end
            || ', or let us know if we missed something?' || E'\n\n' || 'Thanks,' || E'\n' || coalesce(v_first, ''),
            c.vendor_id, null,
            'Freight difference on ' || coalesce(v.name, 'the vendor') || ' invoice ' || coalesce(c.doc_number, '') || ' (VMS made this draft; change it or send it). The task waits for their answer after it goes.',
            case when c.document_id is not null then array[c.document_id] else '{}' end)
    returning id into v_draft;
  insert into public.tasks (organization_id, title, notes, due_date, remind_at, assigned_to, created_by, vendor_id, order_id, auto_key, draft_id, area)
    values (c.organization_id,
            left('Freight on ' || coalesce(v.name, 'vendor') || ' invoice ' || coalesce(c.doc_number, '') || ': charged ' || public.money_text(v_fr)
                 || case when v_exp = 0 then ', should be free' else ', expected ' || public.money_text(v_exp) end, 200),
            v_text || '. The email to ' || coalesce(v.name, 'the vendor') || ' is written and waiting in Drafts.'
            || case when cardinality(coalesce(v_rcpt.to_emails, '{}')) = 0 then ' VMS has no email for them: add one in the To line.' else '' end
            || ' After it goes, this task waits for their answer (or the credit) and closes on its own.',
            current_date, now(), v_who, v_who, c.vendor_id, c.order_id, 'freightissue:' || v_id, v_draft, 'general')
    on conflict (organization_id, auto_key) where auto_key is not null do nothing
    returning id into v_task;
  update public.freight_issues set task_id = v_task, draft_id = v_draft where id = v_id;
  return v_id;
end $$;
revoke execute on function public.freight_issue_check(uuid) from public, anon;
grant execute on function public.freight_issue_check(uuid) to service_role;

update public.email_drafts d set order_id = null from public.freight_issues i where i.draft_id = d.id and d.order_id is not null;

-- Back-check: every request still waiting goes to a person's Drafts
select count(public.shipment_request_review(s.id)) as shipment_requests_to_drafts
  from public.shipment_requests s where s.status = 'ready' and s.review_task_id is null;
