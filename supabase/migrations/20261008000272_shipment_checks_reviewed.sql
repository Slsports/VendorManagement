-- 0272 — The freight check emails go through Trevor first (Dana, Oct 31): "I'm a little concerned about automatically
-- sending those emails without human eyes on the confirmation first. I don't want us to look like idiots to our vendors.
-- Maybe we should just send the draft to Trevor to check the confirmation before sending." And: "Yes, I want the
-- 'the confirmation shows the agreed terms'" tick.
--   • A free / half / capped check is never sent by VMS: the email waits in Trevor's Drafts with a task "Check freight on
--     the confirmation". Trevor opens the confirmation: the terms are there → he ticks **The confirmation shows the agreed
--     terms** on the order's Shipping box (the draft goes away, the task closes); they are not → he sends the email, and
--     the 3-business-day clock starts as usual.
--   • The shipment details email (we pay freight) still goes out on its own.

set local lock_timeout = '5s';

alter table public.shipment_requests add column if not exists review_task_id uuid references public.tasks(id) on delete set null;
alter table public.shipment_requests add column if not exists review_draft_id uuid references public.email_drafts(id) on delete set null;

-- the draft and Trevor's task for a check request (called by shipment_request_make for every kind but 'details')
create or replace function public.shipment_request_review(p_req uuid) returns uuid language plpgsql security definer set search_path = public as $$
declare s public.shipment_requests%rowtype; o public.orders%rowtype; v_name text; m record; v_draft uuid; v_task uuid; v_terms text; v_po text;
begin
  select * into s from public.shipment_requests where id = p_req;
  if s.id is null or s.status <> 'ready' or s.kind = 'details' or s.review_task_id is not null or s.send_as is null then return null; end if;
  select * into o from public.orders where id = s.order_id;
  select name into v_name from public.vendors where id = s.vendor_id;
  select * into m from public.shipment_request_email(s.id);
  v_terms := public.order_freight_terms(o);
  v_po := coalesce(nullif(trim(o.po_number), ''), '');
  if cardinality(s.to_emails) > 0 then
    insert into public.email_drafts (organization_id, owner_id, created_by, to_emails, cc_emails, subject, body, thread_id, reply_to_email_id, vendor_id, order_id, attach_routing_letter, note)
    values (s.organization_id, s.send_as, s.send_as, s.to_emails, s.cc_emails, m.subject, m.body, m.thread_id, s.reply_to_email_id, s.vendor_id, s.order_id, m.attach_routing_letter,
            'Freight check for ' || coalesce(v_name, 'the vendor') || ', PO ' || v_po || ': send only if the confirmation does not show the agreed terms (VMS, Oct 31)')
    returning id into v_draft;
  end if;
  insert into public.tasks (organization_id, title, notes, due_date, remind_at, assigned_to, created_by, vendor_id, order_id, thread_id, draft_id, auto_key)
  values (s.organization_id, left('Check freight on the confirmation: ' || coalesce(v_name, 'the vendor') || ', PO ' || v_po, 200),
          'It looks like the confirmation does not say who pays freight. We agreed ' || case v_terms when 'free' then 'free freight' when 'half' then 'they cover half' else 'freight capped at ' || coalesce(o.freight_cap_pct::text, '?') || '%' end
            || '. Open the confirmation on the order. If the terms are there, click "The confirmation shows the agreed terms" in the order''s Shipping box and this task closes. If not, the email asking them is ready in your Drafts (Go to it): send it as is or change it.'
            || case when cardinality(s.to_emails) = 0 then ' No email on file for this vendor yet: add one on the vendor page first.' else '' end,
          public.next_business_day(now()), now(), s.send_as, s.send_as, s.vendor_id, s.order_id, m.thread_id, v_draft, 'shipcheck:' || s.id)
  on conflict (organization_id, auto_key) where auto_key is not null do nothing returning id into v_task;
  update public.shipment_requests set hold = true, review_task_id = v_task, review_draft_id = v_draft where id = s.id;
  return v_task;
end $$;
revoke execute on function public.shipment_request_review(uuid) from public, anon, authenticated;
grant execute on function public.shipment_request_review(uuid) to service_role;

-- a check request made from now on goes to Trevor's eyes, never straight out
create or replace function public.shipment_requests_review_new() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.kind <> 'details' and new.status = 'ready' then perform public.shipment_request_review(new.id); end if;
  return null;
end $$;
drop trigger if exists shipment_requests_review_new on public.shipment_requests;
create trigger shipment_requests_review_new after insert on public.shipment_requests for each row execute function public.shipment_requests_review_new();

-- Trevor sends the draft: the request is sent (the 3-business-day clock starts) and the check task closes.
-- A follow-up that waits on the vendor (shipment details, credits) keeps its task open; a PO ask is stamped (0235).
create or replace function public.mail_command_sent(p_draft uuid, p_email uuid, p_by uuid) returns void
language plpgsql security definer set search_path = public as $$
declare t public.tasks%rowtype; e public.emails%rowtype; a public.po_asks%rowtype;
begin
  select * into e from public.emails where id = p_email;
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
  if t.auto_key like 'shipcheck:%' then
    perform public.shipment_request_sent(substr(t.auto_key, 11)::uuid, p_email);
    update public.shipment_requests set review_draft_id = null where review_draft_id = p_draft;
    update public.tasks set done_at = now(), done_by = p_by, closed_how = 'person', done_note = 'Sent the vendor the freight check email.', thread_id = coalesce(e.thread_id, thread_id), draft_id = null where id = t.id;
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

-- "The confirmation shows the agreed terms" (a person ticks it on the order): the check is settled, draft gone, task closed.
create or replace function public.orders_terms_confirmed() returns trigger language plpgsql security definer set search_path = public as $$
declare s public.shipment_requests%rowtype;
begin
  if new.freight_terms_confirmed_at is not null and old.freight_terms_confirmed_at is null then
    select * into s from public.shipment_requests where order_id = new.id and status = 'ready' and kind <> 'details';
    if s.id is not null then
      update public.shipment_requests set status = 'confirmed', hold = false, note = 'The confirmation shows the agreed terms (ticked on the order).' where id = s.id;
      delete from public.email_drafts where id = s.review_draft_id and gmail_draft_id is null;
      update public.tasks set done_at = now(), closed_how = 'vms', done_note = 'The confirmation shows the agreed terms (ticked on the order); no email needed.', draft_id = null where id = s.review_task_id and done_at is null;
    end if;
  end if;
  return null;
end $$;
drop trigger if exists orders_terms_confirmed on public.orders;
create trigger orders_terms_confirmed after update of freight_terms_confirmed_at on public.orders for each row execute function public.orders_terms_confirmed();

-- the Freight list's "Send now" on a check request also counts as Trevor's eyes: it sends and closes the task
create or replace function public.shipment_request_sent(p_req uuid, p_email uuid) returns void language plpgsql security definer set search_path = public as $$
declare s public.shipment_requests%rowtype; v_thread uuid;
begin
  select * into s from public.shipment_requests where id = p_req;
  if s.id is null then return; end if;
  select e.thread_id into v_thread from public.emails e where e.id = p_email;
  update public.shipment_requests set status = 'sent', sent_email_id = p_email, thread_id = v_thread, sent_at = now(), hold = false,
         followup_due_at = public.add_business_days(now(), 3), last_reply_read_at = now(), review_draft_id = null where id = p_req;
  delete from public.email_drafts where id = s.review_draft_id and gmail_draft_id is null;
  update public.tasks set done_at = now(), closed_how = 'vms', done_note = 'The freight check email went to the vendor.', draft_id = null where id = s.review_task_id and done_at is null;
  perform public.order_ship_email_sent(s.order_id, p_email);
  update public.emails set order_id = coalesce(order_id, s.order_id) where id = p_email;
end $$;

-- any check request already waiting goes to Trevor the same way
do $$ declare r record; begin
  for r in select id from public.shipment_requests where kind <> 'details' and status = 'ready' and review_task_id is null loop
    perform public.shipment_request_review(r.id);
  end loop;
end $$;
