-- 0362 — The Freight email, one per order, and the Templates page (Dana, Nov 13: "I want there to be a different flow to
-- catching up with all our vendors for the new freight letter as opposed to the current ordering workflow … For new orders
-- we are working on we dont need to have them click on anything … The freight letter should include the link to the form
-- that ties it to our vendor and po … I want to be able to do this fom every vendor page as well as any task that is at the
-- freight quote stage … 1 click to pull up a draft and edit, or not and send" … her wording, paragraph by paragraph … "these
-- should create once we have confirmed" … "go").
--   • message_templates: the wording of what VMS sends vendors, edited on the Templates page. First: freight_email.
--   • Every confirmed order gets the same Freight email (its terms 1-4 are in it): the order's own form link, the routing
--     letter attached (with that link printed in it, gmail-send), and "click here" to record they got the routing
--     instructions (a routing_letter_sends row, no automatic reminder). Free freight on the confirmation still skips it.
--   • freight_email_open(order): the one-click button (vendor page, order page, freight tasks, the activity feed): the
--     order's Freight email draft, made now if there is none (any order not cancelled). Sending it, however it was opened,
--     stamps the order and starts the 3-business-day follow-up.
set local lock_timeout = '5s';

create table if not exists public.message_templates (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  key             text not null,
  category        text not null,
  title           text not null,
  description     text not null default '',
  subject         text not null default '',
  body            text not null,
  updated_at      timestamptz not null default now(),
  updated_by      uuid references public.profiles(id) on delete set null,
  primary key (organization_id, key)
);
comment on table public.message_templates is 'The wording of emails and letters VMS writes to vendors, edited on the Templates page (Dana, Nov 13).';
alter table public.message_templates enable row level security;
drop policy if exists message_templates_read on public.message_templates;
create policy message_templates_read on public.message_templates for select to authenticated using (public.user_in_org(organization_id));
drop policy if exists message_templates_edit on public.message_templates;
create policy message_templates_edit on public.message_templates for update to authenticated using (public.user_in_org(organization_id) and public.user_can_edit()) with check (public.user_in_org(organization_id));
grant select, update on public.message_templates to authenticated;
grant all on public.message_templates to service_role;

create or replace function public.message_templates_touch() returns trigger language plpgsql security definer set search_path = public as $$
begin new.updated_at := now(); new.updated_by := coalesce(auth.uid(), new.updated_by); return new; end $$;
revoke execute on function public.message_templates_touch() from public, anon, authenticated;
drop trigger if exists message_templates_touch on public.message_templates;
create trigger message_templates_touch before update on public.message_templates for each row execute function public.message_templates_touch();

insert into public.message_templates (organization_id, key, category, title, description, subject, body)
select o.id, 'freight_email', 'Freight', 'Freight email (one per order)',
       'Drafted for Trevor once an order is confirmed, and by the Freight email button. Fill-ins: {first_name}, {po}, {vendor}, {form_link} (this order''s freight form), {receipt_link} (they got the routing letter).',
       'Freight for our PO {po} – Shaver Lake Sports', 'Hi {first_name},

Thank you for preparing our order. Before it ships, please find the freight terms below that correspond to this order and follow our freight instructions. Our freight routing letter is attached; please keep it on record for future shipments.

**1. Free freight:** reply to this email to confirm that this order and any backorders ship free. Then ship it. No quote or approval needed.

**2. Half freight:** We have to approve a freight quote before shipping. Please fill out our freight form with your quote and the shipment details: [Click Here]({form_link}). We''ll compare rates and tell you how to ship it.

**3. Freight cap:**
- **Cap of 10% or less of our merchandise cost:** reply to this email to confirm the cap and ship it. No quote needed.
- **Cap over 10%:** fill out the freight form with your quote: [Click Here]({form_link}). We will get back to you promptly with instructions.

**4. We pay the freight:**
- **Freight 10% or less of our merchandise cost:** ship it and add the freight to your invoice. Also, please [click here]({receipt_link}) to confirm you received our routing instructions for future orders.
- **Over 10%:** fill out the freight form with your quote: [Click Here]({form_link}). We will get back to you promptly with instructions.

The form takes about two minutes to complete and will auto populate our PO for this order, please make sure it matches your PO. Questions? Reply to this email which is: orders@shaverlakesports.com.

Thank you!'
  from public.organizations o
on conflict (organization_id, key) do nothing;

alter table public.shipment_requests add column if not exists routing_send_id uuid references public.routing_letter_sends(id) on delete set null;

/** The Freight email from its template (every kind): the order's form link and the routing letter's "click here". */
create or replace function public.shipment_request_email(p_req uuid)
returns table (subject text, body text, to_emails text[], cc_emails text[], reply_to_email_id uuid, thread_id uuid, send_as uuid, vendor_id uuid, order_id uuid, attach_routing_letter boolean)
language plpgsql security definer set search_path = public as $$
declare s public.shipment_requests%rowtype; o public.orders%rowtype; v public.vendors%rowtype; t public.message_templates%rowtype;
        v_first text; v_po text; v_link text; v_subj text; v_body text; v_letter uuid; v_send uuid; v_tok uuid;
begin
  select * into s from public.shipment_requests x where x.id = p_req;
  if s.id is null then return; end if;
  select * into o from public.orders x where x.id = s.order_id;
  select * into v from public.vendors x where x.id = s.vendor_id;
  select * into t from public.message_templates x where x.organization_id = s.organization_id and x.key = 'freight_email';
  v_po := coalesce(nullif(trim(o.po_number), ''), '');
  select split_part(nullif(trim(coalesce(e.from_name, ve.contact_name, '')), ''), ' ', 1) into v_first
    from (select 1) z left join public.emails e on e.id = s.reply_to_email_id left join public.vendor_emails ve on ve.vendor_id = s.vendor_id and lower(ve.email) = s.to_emails[1] and ve.former_at is null limit 1;
  v_link := 'https://vms.shaverlakesports.com/ship/' || s.token;
  -- the routing letter rides along; the first person it goes to gets a "click here" that records they have it (no reminder)
  select x.id into v_letter from public.routing_letters x where x.organization_id = s.organization_id order by x.version desc limit 1;
  if v_letter is not null and cardinality(s.to_emails) > 0 then
    insert into public.routing_letter_sends (organization_id, letter_id, vendor_id, contact_name, email, reminded_at)
    values (s.organization_id, v_letter, s.vendor_id, nullif(v_first, ''), lower(s.to_emails[1]), now())
    on conflict (letter_id, email) do nothing;
    select x.id, x.token into v_send, v_tok from public.routing_letter_sends x where x.letter_id = v_letter and x.email = lower(s.to_emails[1]);
    update public.shipment_requests set routing_send_id = v_send where id = s.id and routing_send_id is distinct from v_send;
  end if;
  v_subj := replace(replace(coalesce(nullif(t.subject, ''), 'Freight for our PO {po} – Shaver Lake Sports'), '{po}', v_po), '{vendor}', coalesce(v.name, ''));
  v_body := coalesce(t.body, '');
  if v_tok is null then v_body := replace(replace(v_body, '[click here]({receipt_link})', 'reply to this email'), '[Click here]({receipt_link})', 'reply to this email'); end if;
  v_body := replace(replace(replace(replace(replace(v_body,
              '{first_name}', coalesce(nullif(v_first, ''), 'there')),
              '{po}', v_po), '{vendor}', coalesce(v.name, '')),
              '{form_link}', v_link),
              '{receipt_link}', coalesce('https://vms.shaverlakesports.com/r/' || v_tok, ''));
  return query select v_subj, v_body, s.to_emails, s.cc_emails, s.reply_to_email_id, (select e.thread_id from public.emails e where e.id = s.reply_to_email_id), s.send_as, s.vendor_id, s.order_id,
                      v_letter is not null;
end $$;
revoke execute on function public.shipment_request_email(uuid) from public, anon;
grant execute on function public.shipment_request_email(uuid) to authenticated, service_role;

create or replace function public.shipment_request_make(p_order uuid, p_hold boolean default false) returns uuid
language plpgsql security definer set search_path = public as $$
declare o public.orders%rowtype; v public.vendors%rowtype; r record; v_terms text; v_shown text; v_kind text; v_id uuid; v_who uuid; v_po text;
begin
  select * into o from public.orders where id = p_order;
  if o.id is null or o.status <> 'confirmed' or o.vendor_id is null then return null; end if;
  select * into v from public.vendors where id = o.vendor_id;
  if v.web_orders or coalesce(v.no_order_checks, false) then return null; end if;
  select id into v_id from public.shipment_requests where order_id = o.id;
  if v_id is not null then return v_id; end if;
  if exists (select 1 from public.freight_quotes q where q.order_id = o.id and q.status = 'approved') then return null; end if;
  v_terms := public.order_freight_terms(o);
  v_shown := public.confirmation_freight(o.id);
  v_who := coalesce(public.logistics_person(o.organization_id), public.org_admin(o.organization_id));
  v_po := coalesce(nullif(trim(o.po_number), ''), '');
  -- free freight agreed and shown on the confirmation: nothing goes out
  if v_terms = 'free' and v_shown = 'free' then
    update public.orders set freight_terms_confirmed_at = coalesce(freight_terms_confirmed_at, now()), freight_terms_confirmed_how = coalesce(freight_terms_confirmed_how, 'confirmation') where id = o.id;
    insert into public.shipment_requests (organization_id, order_id, vendor_id, kind, status, skip_reason, send_as)
      values (o.organization_id, o.id, o.vendor_id, 'free_check', 'skipped', 'Free freight is shown on the confirmation.', v_who) returning id into v_id;
    return v_id;
  end if;
  -- one Freight email for every order (Dana, Nov 13): the vendor finds their terms in it
  v_kind := 'details';
  select * into r from public.shipment_request_recipients(o.id);
  insert into public.shipment_requests (organization_id, order_id, vendor_id, kind, status, hold, to_emails, cc_emails, reply_to_email_id, send_as, note)
    values (o.organization_id, o.id, o.vendor_id, v_kind, 'ready', p_hold, coalesce(r.to_emails, '{}'), coalesce(r.cc_emails, '{}'), r.reply_to, v_who,
            case when cardinality(coalesce(r.to_emails, '{}')) = 0 then 'No email on file for this vendor: add one on the vendor page and VMS sends it.' end)
    returning id into v_id;
  -- the Oct 20 placeholder shipping email is replaced by this one
  delete from public.email_drafts where order_id = o.id and gmail_draft_id is null and subject like 'Shipping instructions for %';
  if cardinality(coalesce(r.to_emails, '{}')) = 0 and v_who is not null then
    insert into public.tasks (organization_id, title, notes, due_date, remind_at, assigned_to, vendor_id, order_id, auto_key)
    values (o.organization_id, left('No email for ' || coalesce(v.name, 'the vendor') || case when v_po <> '' then ', PO ' || v_po else '' end || ': add one and VMS sends the shipment form', 200),
            'VMS could not find who to send the shipment details email to. Add the vendor''s Shipping or Orders contact (or the rep) on the vendor page; the email goes out on its own within a few minutes.',
            current_date, now(), v_who, v.id, o.id, 'shipreq_noemail:' || v_id)
    on conflict (organization_id, auto_key) where auto_key is not null do nothing;
  end if;
  return v_id;
end $$;

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
            case when v_details then 'Freight email for ' || coalesce(v_name, 'the vendor') || ', PO ' || v_po || ': VMS wrote it; it goes only when you press Send (Dana, Nov 9)'
                 else 'Freight check for ' || coalesce(v_name, 'the vendor') || ', PO ' || v_po || ': send only if the confirmation does not show the agreed terms (VMS, Oct 31)' end)
    returning id into v_draft;
  end if;
  if v_details then
    insert into public.tasks (organization_id, title, notes, due_date, remind_at, assigned_to, created_by, vendor_id, order_id, thread_id, draft_id, auto_key)
    values (s.organization_id, left('Send the freight email: ' || coalesce(v_name, 'the vendor') || ', PO ' || v_po, 200),
            'The order is confirmed. The freight email to ' || coalesce(v_name, 'the vendor') || ' (their freight terms, the form link for this order, our routing letter attached) is written and waiting in your Drafts (Go to it). Check it and press Send; VMS never sends it on its own. After it goes, VMS waits 3 business days for their answer.'
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
         done_note = 'The freight email went to the vendor.'
   where id = s.review_task_id and done_at is null;
  perform public.order_ship_email_sent(s.order_id, p_email);
  -- the routing letter went with it (Nov 13): that person has it on record
  if s.routing_send_id is not null then perform public.routing_letter_mark_sent(s.routing_send_id, p_email, null); end if;
  update public.emails set order_id = coalesce(order_id, s.order_id) where id = p_email;
end $$;

create or replace function public.mail_command_sent(p_draft uuid, p_email uuid, p_by uuid) returns void
language plpgsql security definer set search_path = public as $$
declare t public.tasks%rowtype; e public.emails%rowtype; a public.po_asks%rowtype;
begin
  select * into e from public.emails where id = p_email;
  -- the freight email, however it was opened (the task, the order, the vendor page): stamped on its request (Nov 13)
  if exists (select 1 from public.shipment_requests where review_draft_id = p_draft) then
    update public.tasks set done_at = now(), done_by = p_by, closed_how = 'person', done_note = 'Sent the vendor the freight email.', draft_id = null,
           thread_id = coalesce(e.thread_id, thread_id)
     where draft_id = p_draft and done_at is null;
    perform public.shipment_request_sent((select id from public.shipment_requests where review_draft_id = p_draft limit 1), p_email);
    return;
  end if;
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

/** One click (Dana, Nov 13): the order's Freight email draft, made now when there is none; any order not cancelled. */
create or replace function public.freight_email_open(p_order uuid) returns uuid
language plpgsql security definer set search_path = public as $$
declare o public.orders%rowtype; s public.shipment_requests%rowtype; r record; m record; v_draft uuid; v_name text; v_po text;
begin
  select * into o from public.orders where id = p_order;
  if o.id is null or not (public.user_in_org(o.organization_id) and public.user_can_edit()) then raise exception 'Order not found' using errcode = '42501'; end if;
  if o.status = 'cancelled' then raise exception 'This order is cancelled' using errcode = '22023'; end if;
  if o.vendor_id is null then raise exception 'Pick the vendor on the order first' using errcode = '22023'; end if;
  select * into s from public.shipment_requests where order_id = o.id;
  if s.id is not null and s.review_draft_id is not null and exists (select 1 from public.email_drafts where id = s.review_draft_id) then return s.review_draft_id; end if;
  select * into r from public.shipment_request_recipients(o.id);
  if s.id is null then
    insert into public.shipment_requests (organization_id, order_id, vendor_id, kind, status, hold, to_emails, cc_emails, reply_to_email_id, send_as, note)
    values (o.organization_id, o.id, o.vendor_id, 'details', 'ready', true, coalesce(r.to_emails, '{}'), coalesce(r.cc_emails, '{}'), r.reply_to, auth.uid(), 'Opened with the Freight email button.')
    returning * into s;
  else
    update public.shipment_requests set kind = 'details',
           status = case when status in ('skipped', 'cancelled') then 'ready' else status end, skip_reason = null,
           to_emails = case when cardinality(to_emails) = 0 then coalesce(r.to_emails, '{}') else to_emails end,
           cc_emails = case when cardinality(to_emails) = 0 then coalesce(r.cc_emails, '{}') else cc_emails end,
           reply_to_email_id = coalesce(reply_to_email_id, r.reply_to), send_as = coalesce(send_as, auth.uid())
     where id = s.id returning * into s;
  end if;
  select * into m from public.shipment_request_email(s.id);
  select name into v_name from public.vendors where id = o.vendor_id;
  v_po := coalesce(nullif(trim(o.po_number), ''), '');
  insert into public.email_drafts (organization_id, owner_id, created_by, to_emails, cc_emails, subject, body, thread_id, reply_to_email_id, vendor_id, order_id, attach_routing_letter, note)
  values (o.organization_id, auth.uid(), auth.uid(), s.to_emails, s.cc_emails, m.subject, m.body, m.thread_id, s.reply_to_email_id, o.vendor_id, o.id, m.attach_routing_letter,
          'Freight email for ' || coalesce(v_name, 'the vendor') || ', PO ' || v_po || case when cardinality(s.to_emails) = 0 then ': no email on file for this vendor, add who it goes to' else '' end)
  returning id into v_draft;
  update public.shipment_requests set review_draft_id = v_draft where id = s.id;
  -- an open "Send the freight email" task now opens this draft
  update public.tasks set draft_id = v_draft where id = s.review_task_id and done_at is null;
  return v_draft;
end $$;
revoke execute on function public.freight_email_open(uuid) from public, anon;
grant execute on function public.freight_email_open(uuid) to authenticated;


-- the tick on the order ("the confirmation shows the agreed terms") still settles the one Freight email when nothing is left
-- for the vendor to do: free freight, or a cap of 10% or less (Nov 13)
create or replace function public.orders_terms_confirmed() returns trigger language plpgsql security definer set search_path = public as $$
declare s public.shipment_requests%rowtype;
begin
  if new.freight_terms_confirmed_at is not null and old.freight_terms_confirmed_at is null then
    select * into s from public.shipment_requests where order_id = new.id and status = 'ready'
     and (kind <> 'details' or new.freight_terms = 'free' or (new.freight_terms = 'capped' and coalesce(new.freight_cap_pct, 100) <= 10));
    if s.id is not null then
      update public.shipment_requests set status = 'confirmed', hold = false, note = 'The confirmation shows the agreed terms (ticked on the order).' where id = s.id;
      delete from public.email_drafts where id = s.review_draft_id and gmail_draft_id is null;
      update public.tasks set done_at = now(), closed_how = 'vms', done_note = 'The confirmation shows the agreed terms (ticked on the order); no email needed.', draft_id = null where id = s.review_task_id and done_at is null;
    end if;
  end if;
  return null;
end $$;
