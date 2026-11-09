-- 0322 — Freight terms come from the vendor's email; a freight difference stays open until the vendor answers
-- (Dana, Nov 7–9).
--   "If it comes from the vendor and they promise free freight it should log it for that order. Free freight is not an
--    always, every order situation. Each order can have different terms, even if the last order was free."
--   "I do want to know if there is a difference in what was quoted versus what we get on freight … until an email goes
--    off to the vendor about it, that would not be considered handled … we would be waiting for a follow-up from the
--    vendor too."
--
--   • freight_promises: what an email says about freight on an order (free, free over $X, half, capped, charged, a
--     quoted amount), the words it used, who said it, and the order it belongs to. Claude reads the vendor mail
--     (gmail-sync, emails.freight_read_at); the PO, the email's order or the conversation's one order ties it to an
--     order, else it waits for a person ("Which order?" task, picked in the task).
--   • Applying one writes the order's freight terms with a one-click source (orders.freight_terms_source_email_id).
--     Newer email wins; terms a person set on the order stand (a differing email gives that person a task).
--   • freight_issues: an invoice whose freight does not match the order's terms, the accepted quote, the cap, or the
--     vendor's free-freight rule (always, or over its minimum). Each gets a ready email to the vendor and a task.
--     Sending it keeps the task open, retitled "Waiting for …", due in 3 business days. The vendor's answer in that
--     conversation, or a credit for that invoice, closes it (by VMS, with what it saw). A terms change that makes the
--     charge right drops it before anything was sent.
--   • Back-check: every invoice already read is checked now.
set local lock_timeout = '5s';

-- ---- where an order's freight terms came from ---------------------------------------------------------------------
alter table public.orders add column if not exists free_over numeric(12,2);
alter table public.orders add column if not exists freight_quote_amount numeric(12,2);
alter table public.orders add column if not exists freight_terms_source text;
alter table public.orders drop constraint if exists orders_freight_terms_source_check;
alter table public.orders add constraint orders_freight_terms_source_check check (freight_terms_source in ('person', 'summary', 'email'));
alter table public.orders add column if not exists freight_terms_source_email_id uuid references public.emails(id) on delete set null;
comment on column public.orders.free_over is 'Free freight once the order reaches this amount (from the vendor''s email for this order).';
comment on column public.orders.freight_quote_amount is 'The freight amount the vendor stated for this order in an email.';
comment on column public.orders.freight_terms_source is 'Where the freight terms came from: a person on the order, the order sheet, or the vendor''s email (Dana, Nov 9).';
comment on column public.orders.freight_terms_source_email_id is 'The email the freight terms came from (one click to it).';
create index if not exists orders_freight_source_email on public.orders (freight_terms_source_email_id) where freight_terms_source_email_id is not null;
update public.orders set freight_terms_source = case when 'free_shipping' = any (coalesce(edited_fields, '{}')) or 'freight_terms' = any (coalesce(edited_fields, '{}')) then 'person' else 'summary' end
 where freight_terms_source is null and (free_shipping is not null or freight_terms is not null);

alter table public.emails add column if not exists freight_read_at timestamptz;
comment on column public.emails.freight_read_at is 'Claude read this email for freight terms on an order (Dana, Nov 9).';

create table if not exists public.freight_promises (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  email_id        uuid not null references public.emails(id) on delete cascade,
  thread_id       uuid references public.email_threads(id) on delete set null,
  vendor_id       uuid references public.vendors(id) on delete cascade,
  order_id        uuid references public.orders(id) on delete set null,
  po_text         text,
  terms           text not null check (terms in ('free', 'free_over', 'half', 'capped', 'charged', 'quoted')),
  basis           text check (basis in ('show_special', 'minimum_met', 'negotiated', 'always', 'other')),
  free_over       numeric(12,2),
  cap_pct         numeric(6,2),
  amount          numeric(12,2),
  said_by         text not null default 'vendor' check (said_by in ('vendor', 'us')),
  quote           text not null default '',
  status          text not null default 'needs_order' check (status in ('applied', 'needs_order', 'person_set', 'superseded', 'not_an_order')),
  task_id         uuid references public.tasks(id) on delete set null,
  said_on         timestamptz not null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
comment on table public.freight_promises is 'Freight terms an email states for an order (Dana, Nov 9): read by Claude, tied to the order, applied with a link to the email.';
create index if not exists freight_promises_order on public.freight_promises (order_id);
create index if not exists freight_promises_email on public.freight_promises (email_id);
create index if not exists freight_promises_vendor_open on public.freight_promises (vendor_id) where status = 'needs_order';
alter table public.freight_promises enable row level security;
drop policy if exists freight_promises_read on public.freight_promises;
create policy freight_promises_read on public.freight_promises for select to authenticated using (public.user_in_org(organization_id));
grant select on public.freight_promises to authenticated;
grant all on public.freight_promises to service_role;
drop trigger if exists freight_promises_touch on public.freight_promises;
create trigger freight_promises_touch before update on public.freight_promises for each row execute function public.set_updated_at();

create table if not exists public.freight_issues (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations(id) on delete cascade,
  check_id         uuid not null references public.order_checks(id) on delete cascade unique,
  vendor_id        uuid not null references public.vendors(id) on delete cascade,
  order_id         uuid references public.orders(id) on delete set null,
  document_id      uuid references public.vendor_links(id) on delete set null,
  invoice_number   text,
  invoice_date     date,
  kind             text not null check (kind in ('free_order', 'over_quote', 'over_cap', 'free_over', 'vendor_always', 'vendor_minimum')),
  charged          numeric(12,2) not null,
  expected         numeric(12,2),
  expected_text    text not null,
  source_email_id  uuid references public.emails(id) on delete set null,
  status           text not null default 'open' check (status in ('open', 'emailed', 'answered', 'credited', 'dropped')),
  task_id          uuid references public.tasks(id) on delete set null,
  draft_id         uuid references public.email_drafts(id) on delete set null,
  emailed_at       timestamptz,
  email_id         uuid references public.emails(id) on delete set null,
  thread_id        uuid references public.email_threads(id) on delete set null,
  answered_at      timestamptz,
  answer_email_id  uuid references public.emails(id) on delete set null,
  closed_note      text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
comment on table public.freight_issues is 'An invoice''s freight that differs from what was agreed (Dana, Nov 7): open until the vendor is emailed and answers, or the credit comes.';
create index if not exists freight_issues_thread on public.freight_issues (thread_id) where status = 'emailed';
create index if not exists freight_issues_order on public.freight_issues (order_id);
alter table public.freight_issues enable row level security;
drop policy if exists freight_issues_read on public.freight_issues;
create policy freight_issues_read on public.freight_issues for select to authenticated using (public.user_in_org(organization_id));
grant select on public.freight_issues to authenticated;
grant all on public.freight_issues to service_role;
drop trigger if exists freight_issues_touch on public.freight_issues;
create trigger freight_issues_touch before update on public.freight_issues for each row execute function public.set_updated_at();

create or replace function public.money_text(p numeric) returns text language sql immutable as $$
  select '$' || to_char(coalesce(p, 0), 'FM999,999,990.00')
$$;
grant execute on function public.money_text(numeric) to authenticated, service_role;

-- ---- who the freight email goes to ---------------------------------------------------------------------------------
create or replace function public.freight_issue_recipients(p_vendor uuid, p_order uuid, out to_emails text[], out cc_emails text[])
language plpgsql stable security definer set search_path = public as $$
declare v public.vendors%rowtype; r record; bad constant text := '(no-?reply|do-?not-?reply|notification|mailer-daemon|edenred|laservault)';
begin
  to_emails := '{}'; cc_emails := '{}';
  if p_order is not null then
    select * into r from public.shipment_request_recipients(p_order);
    to_emails := coalesce(r.to_emails, '{}'); cc_emails := coalesce(r.cc_emails, '{}');
    if cardinality(to_emails) > 0 then return; end if;
  end if;
  select * into v from public.vendors where id = p_vendor;
  select coalesce(array_agg(distinct lower(email)), '{}') into to_emails from public.vendor_emails
   where vendor_id = p_vendor and email is not null and former_at is null and bad_email_at is null and email !~* bad
     and ('ap' = any (roles) or contact_type = 'ap' or 'customer_service' = any (roles) or contact_type = 'customer_service');
  if cardinality(to_emails) = 0 then
    select coalesce(array_agg(distinct lower(email)), '{}') into to_emails from public.vendor_emails
     where vendor_id = p_vendor and email is not null and former_at is null and bad_email_at is null and email !~* bad
       and ('orders' = any (roles) or contact_type = 'orders');
  end if;
  if cardinality(to_emails) = 0 and v.email is not null and v.email !~* bad then to_emails := array[lower(v.email)]; end if;
  if cardinality(to_emails) = 0 then
    select coalesce(array_agg(distinct lower(c.email)), '{}') into to_emails from public.rep_group_contacts c
     where c.rep_group_id = v.rep_group_id and c.email is not null and c.former_at is null and c.email !~* bad;
  end if;
end $$;
revoke execute on function public.freight_issue_recipients(uuid, uuid) from public, anon;
grant execute on function public.freight_issue_recipients(uuid, uuid) to service_role;

-- ---- does an invoice's freight match what was agreed? --------------------------------------------------------------
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
            c.vendor_id, c.order_id,
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

-- an invoice read (or read again) is checked; an order's terms changing checks its invoices
create or replace function public.freight_issue_on_check() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.kind = 'invoice' and new.reading is not null then perform public.freight_issue_check(new.id); end if;
  return null;
end $$;
revoke execute on function public.freight_issue_on_check() from public, anon;
drop trigger if exists order_checks_freight_issue on public.order_checks;
create trigger order_checks_freight_issue after insert or update of reading, order_id on public.order_checks
  for each row execute function public.freight_issue_on_check();

create or replace function public.freight_issue_on_order() returns trigger
language plpgsql security definer set search_path = public as $$
declare k uuid;
begin
  for k in select id from public.order_checks where order_id = new.id and kind = 'invoice' and reading is not null loop
    perform public.freight_issue_check(k);
  end loop;
  return null;
end $$;
revoke execute on function public.freight_issue_on_order() from public, anon;
drop trigger if exists orders_freight_issue on public.orders;
create trigger orders_freight_issue after update of free_shipping, freight_terms, freight_cap_pct, free_over, freight_quote_amount, freight_notes on public.orders
  for each row execute function public.freight_issue_on_order();

-- ---- the email went: wait for their answer -------------------------------------------------------------------------
create or replace function public.freight_issue_sent(p_draft uuid, p_email uuid) returns boolean
language plpgsql security definer set search_path = public as $$
declare i public.freight_issues%rowtype; e public.emails%rowtype; v_name text;
begin
  select * into i from public.freight_issues where draft_id = p_draft;
  if i.id is null then return false; end if;
  select * into e from public.emails where id = p_email;
  select name into v_name from public.vendors where id = i.vendor_id;
  update public.freight_issues set status = 'emailed', emailed_at = coalesce(e.received_at, now()), email_id = p_email, thread_id = e.thread_id, draft_id = null where id = i.id;
  -- not a second credit request with its own task: this one tracks it
  update public.emails set credit_read_at = coalesce(credit_read_at, now()) where id = p_email;
  update public.tasks set draft_id = null, thread_id = coalesce(e.thread_id, thread_id),
         title = left('Waiting for ' || coalesce(v_name, 'the vendor') || ': freight on invoice ' || coalesce(i.invoice_number, ''), 200),
         due_date = (public.add_business_days(now(), 3) at time zone 'America/Los_Angeles')::date,
         remind_at = public.add_business_days(now(), 3),
         notes = coalesce(notes, '') || E'\n\n' || 'Emailed ' || coalesce(v_name, 'the vendor') || ' on ' || to_char(coalesce(e.received_at, now()) at time zone 'America/Los_Angeles', 'FMMM/FMDD/YY')
                 || '. This task closes when they answer in that conversation or the credit comes.'
   where id = i.task_id and done_at is null;
  return true;
end $$;
revoke execute on function public.freight_issue_sent(uuid, uuid) from public, anon;
grant execute on function public.freight_issue_sent(uuid, uuid) to service_role;

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

-- ---- their answer, or the credit, closes it -----------------------------------------------------------------------
create or replace function public.freight_issue_close(p_issue uuid, p_status text, p_note text, p_email uuid default null) returns void
language plpgsql security definer set search_path = public as $$
declare i public.freight_issues%rowtype;
begin
  update public.freight_issues set status = p_status, closed_note = p_note, answered_at = case when p_email is not null then now() else answered_at end,
         answer_email_id = coalesce(p_email, answer_email_id)
   where id = p_issue and status in ('open', 'emailed') returning * into i;
  if i.id is null then return; end if;
  update public.tasks set done_at = now(), closed_how = 'vms', done_note = 'VMS closed it: ' || p_note, done_email_id = coalesce(p_email, done_email_id)
   where id = i.task_id and done_at is null;
end $$;
revoke execute on function public.freight_issue_close(uuid, text, text, uuid) from public, anon;
grant execute on function public.freight_issue_close(uuid, text, text, uuid) to service_role;

create or replace function public.freight_issue_on_email() returns trigger
language plpgsql security definer set search_path = public as $$
declare i record; v_name text;
begin
  if new.direction <> 'in' or new.thread_id is null or new.copy_of is not null then return null; end if;
  for i in select * from public.freight_issues where thread_id = new.thread_id and status = 'emailed' and emailed_at < new.received_at loop
    select name into v_name from public.vendors where id = i.vendor_id;
    perform public.freight_issue_close(i.id, 'answered',
      coalesce(v_name, 'The vendor') || ' answered about the freight on invoice ' || coalesce(i.invoice_number, '') || ' on '
      || to_char(new.received_at at time zone 'America/Los_Angeles', 'FMMM/FMDD/YY') || ' (their email is linked).', new.id);
  end loop;
  return null;
end $$;
revoke execute on function public.freight_issue_on_email() from public, anon;
drop trigger if exists emails_freight_issue on public.emails;
create trigger emails_freight_issue after insert on public.emails for each row execute function public.freight_issue_on_email();

create or replace function public.freight_issue_on_credit() returns trigger
language plpgsql security definer set search_path = public as $$
declare i record;
begin
  if new.kind <> 'credit' or new.vendor_id is null then return null; end if;
  for i in select * from public.freight_issues f where f.vendor_id = new.vendor_id and f.status in ('open', 'emailed')
             and ((new.order_id is not null and new.order_id = f.order_id)
                  or (f.invoice_number is not null and coalesce(new.label, '') || ' ' || coalesce(new.file_name, '') || ' ' || coalesce(new.doc_po, '') ilike '%' || f.invoice_number || '%')
                  or (new.doc_total is not null and abs(abs(new.doc_total) - (f.charged - coalesce(f.expected, 0))) < 0.02 and new.created_at > f.created_at)) loop
    perform public.freight_issue_close(i.id, 'credited', 'a credit from the vendor came in (' || coalesce(new.label, new.file_name, 'credit') || ').', null);
  end loop;
  return null;
end $$;
revoke execute on function public.freight_issue_on_credit() from public, anon;
drop trigger if exists vendor_links_freight_issue on public.vendor_links;
create trigger vendor_links_freight_issue after insert or update of kind, order_id on public.vendor_links for each row execute function public.freight_issue_on_credit();

-- ---- freight terms from an email ----------------------------------------------------------------------------------
-- tie a reading to its order: the PO it names, else the email's order, else the conversation's one order
create or replace function public.freight_promise_order(p_promise uuid) returns uuid
language plpgsql stable security definer set search_path = public as $$
declare p public.freight_promises%rowtype; e public.emails%rowtype; v_id uuid; n integer;
begin
  select * into p from public.freight_promises where id = p_promise;
  select * into e from public.emails where id = p.email_id;
  if public.po_key(p.po_text) is not null then
    select count(*), min(o.id::text)::uuid into n, v_id from public.orders o
     where o.organization_id = p.organization_id and o.status <> 'cancelled' and public.po_key(o.po_number) = public.po_key(p.po_text)
       and (p.vendor_id is null or o.vendor_id = p.vendor_id or o.brand_vendor_id = p.vendor_id);
    if n = 1 then return v_id; end if;
  end if;
  if e.order_id is not null then return e.order_id; end if;
  select count(distinct x.order_id), min(x.order_id::text)::uuid into n, v_id from public.emails x
   where x.thread_id = e.thread_id and x.order_id is not null;
  if n = 1 then return v_id; end if;
  return null;
end $$;
revoke execute on function public.freight_promise_order(uuid) from public, anon;
grant execute on function public.freight_promise_order(uuid) to service_role;

create or replace function public.freight_promise_apply(p_promise uuid, p_order uuid default null, p_by uuid default null) returns text
language plpgsql security definer set search_path = public as $$
declare p public.freight_promises%rowtype; o public.orders%rowtype; v_order uuid; v_prev timestamptz; v_note text; v_who uuid; v_vn text; v_free boolean; v_terms text;
begin
  select * into p from public.freight_promises where id = p_promise;
  if p.id is null then return null; end if;
  v_order := coalesce(p_order, p.order_id, public.freight_promise_order(p.id));
  if v_order is null then
    if p.status <> 'needs_order' then update public.freight_promises set status = 'needs_order' where id = p.id; end if;
    return 'needs_order';
  end if;
  select * into o from public.orders where id = v_order;
  update public.freight_promises set order_id = o.id, vendor_id = coalesce(vendor_id, o.vendor_id) where id = p.id;
  select name into v_vn from public.vendors where id = o.vendor_id;
  v_note := left('Per ' || case when p.said_by = 'us' then 'our' else coalesce(v_vn, 'the vendor') || '''s' end || ' email of '
           || to_char(p.said_on at time zone 'America/Los_Angeles', 'FMMM/FMDD/YY') || ': "' || p.quote || '"', 300);
  -- a quoted amount only: kept on the order, the terms stay as they are
  if p.terms = 'quoted' then
    update public.orders set freight_quote_amount = p.amount where id = o.id and (freight_quote_amount is distinct from p.amount);
    update public.freight_promises set status = 'applied' where id = p.id;
    perform public.freight_promise_done(p.id);
    return 'applied';
  end if;
  -- terms a person set on the order stand; a differing email goes to them
  if o.freight_terms_source = 'person' and p_by is null then
    v_terms := case p.terms when 'free_over' then case when coalesce(o.est_cost, 0) >= p.free_over then 'free' else 'charged' end else p.terms end;
    if public.order_freight_terms(o) is distinct from v_terms then
      v_who := coalesce(o.placed_by_id, public.org_admin(o.organization_id));
      insert into public.tasks (organization_id, title, notes, due_date, remind_at, assigned_to, created_by, vendor_id, order_id, thread_id, auto_key, area)
        values (o.organization_id, left('Freight terms on ' || coalesce(v_vn, 'vendor') || ' PO ' || coalesce(o.po_number, '') || ': the email and the order differ', 200),
                v_note || '. The order says ' || public.order_freight_terms(o) || ' (set by a person). Change the order''s freight if the email is right.',
                current_date, now(), v_who, v_who, o.vendor_id, o.id, p.thread_id, 'freightterms:' || p.id, 'general')
        on conflict (organization_id, auto_key) where auto_key is not null do nothing;
      update public.freight_promises set status = 'person_set' where id = p.id;
      return 'person_set';
    end if;
    update public.freight_promises set status = 'applied' where id = p.id;
    perform public.freight_promise_done(p.id);
    return 'applied';
  end if;
  -- newer email wins: an older email does not undo a newer one
  select e.received_at into v_prev from public.emails e where e.id = o.freight_terms_source_email_id;
  if o.freight_terms_source = 'email' and v_prev is not null and v_prev > p.said_on and p_by is null then
    update public.freight_promises set status = 'superseded' where id = p.id;
    perform public.freight_promise_done(p.id);
    return 'superseded';
  end if;
  v_free := case p.terms when 'free' then true when 'free_over' then case when o.est_cost is not null then o.est_cost >= p.free_over end else false end;
  update public.orders set
    free_shipping = v_free,
    free_shipping_basis = case when v_free then coalesce(p.basis, case when p.terms = 'free_over' then 'minimum_met' else 'negotiated' end) end,
    free_shipping_note = v_note,
    freight_terms = case p.terms when 'free' then 'free' when 'half' then 'half' when 'capped' then 'capped' when 'charged' then 'charged'
                                 when 'free_over' then case when v_free then 'free' when v_free = false then 'charged' end end,
    freight_cap_pct = case when p.terms = 'capped' then p.cap_pct else freight_cap_pct end,
    free_over = case when p.terms = 'free_over' then p.free_over else null end,
    freight_quote_amount = case when p.amount is not null and p.terms in ('charged', 'capped', 'half') then p.amount else freight_quote_amount end,
    freight_terms_source = case when p_by is not null then 'person' else 'email' end,
    freight_terms_source_email_id = p.email_id
   where id = o.id;
  update public.freight_promises set status = 'superseded' where order_id = o.id and id <> p.id and status = 'applied';
  update public.freight_promises set status = 'applied' where id = p.id;
  perform public.freight_promise_done(p.id);
  return 'applied';
end $$;
revoke execute on function public.freight_promise_apply(uuid, uuid, uuid) from public, anon;
grant execute on function public.freight_promise_apply(uuid, uuid, uuid) to service_role;

-- its "Which order?" task closes once it is tied to an order (or set aside)
create or replace function public.freight_promise_done(p_promise uuid) returns void
language plpgsql security definer set search_path = public as $$
declare p public.freight_promises%rowtype; v_po text;
begin
  select * into p from public.freight_promises where id = p_promise;
  if p.task_id is null then return; end if;
  select po_number into v_po from public.orders where id = p.order_id;
  update public.tasks set done_at = now(), closed_how = coalesce(closed_how, 'vms'),
         done_note = coalesce(done_note, case when p.order_id is not null then 'VMS put the freight terms from the email on PO ' || coalesce(v_po, '(no PO)') || '.'
                                              else 'Set aside: the email''s freight terms are not for one of our orders.' end)
   where id = p.task_id and done_at is null;
end $$;
revoke execute on function public.freight_promise_done(uuid) from public, anon;
grant execute on function public.freight_promise_done(uuid) to service_role;

-- the reader's findings for one email (gmail-sync): saved, tied to the order, applied; "Which order?" when it can't tell
create or replace function public.freight_promises_save(p_email uuid, p_items jsonb) returns integer
language plpgsql security definer set search_path = public as $$
declare e public.emails%rowtype; t public.email_threads%rowtype; x jsonb; v_id uuid; n integer := 0; v_res text; v_who uuid; v_vn text; v_terms text;
begin
  select * into e from public.emails where id = p_email;
  if e.id is null then return 0; end if;
  select * into t from public.email_threads where id = e.thread_id;
  for x in select * from jsonb_array_elements(coalesce(p_items, '[]')) loop
    v_terms := x->>'terms';
    continue when v_terms is null or v_terms not in ('free', 'free_over', 'half', 'capped', 'charged', 'quoted');
    continue when exists (select 1 from public.freight_promises where email_id = e.id and terms = v_terms and coalesce(po_text, '') = coalesce(x->>'po', ''));
    insert into public.freight_promises (organization_id, email_id, thread_id, vendor_id, po_text, terms, basis, free_over, cap_pct, amount, said_by, quote, said_on, status)
      values (e.organization_id, e.id, e.thread_id, coalesce(e.vendor_id, t.vendor_id), nullif(trim(x->>'po'), ''), v_terms,
              case when x->>'basis' in ('show_special', 'minimum_met', 'negotiated', 'always', 'other') then x->>'basis' end,
              nullif(x->>'free_over', '')::numeric, nullif(x->>'cap_pct', '')::numeric, nullif(x->>'amount', '')::numeric,
              case when x->>'said_by' = 'us' then 'us' else 'vendor' end, left(coalesce(x->>'quote', ''), 400), e.received_at, 'needs_order')
      returning id into v_id;
    n := n + 1;
    v_res := public.freight_promise_apply(v_id);
    if v_res = 'needs_order' then
      select name into v_vn from public.vendors where id = coalesce(e.vendor_id, t.vendor_id);
      v_who := coalesce(t.owner_id, public.org_admin(e.organization_id));
      insert into public.tasks (organization_id, title, notes, due_date, remind_at, assigned_to, created_by, vendor_id, thread_id, auto_key, area)
        values (e.organization_id,
                left('Which order? ' || coalesce(v_vn, 'A vendor') || '''s email of ' || to_char(e.received_at at time zone 'America/Los_Angeles', 'FMMM/FMDD/YY') || ' gives freight terms', 200),
                '"' || left(coalesce(x->>'quote', ''), 300) || '". Pick the order these freight terms are for (or None of these) and VMS puts them on it.',
                current_date, now(), v_who, v_who, coalesce(e.vendor_id, t.vendor_id), e.thread_id, 'freightorder:' || v_id, 'general')
        on conflict (organization_id, auto_key) where auto_key is not null do nothing
        returning id into v_who;
      update public.freight_promises set task_id = (select id from public.tasks where organization_id = e.organization_id and auto_key = 'freightorder:' || v_id) where id = v_id;
    end if;
  end loop;
  update public.emails set freight_read_at = now() where id = e.id;
  return n;
end $$;
revoke execute on function public.freight_promises_save(uuid, jsonb) from public, anon;
grant execute on function public.freight_promises_save(uuid, jsonb) to service_role;

-- the person's pick in the "Which order?" task (or None of these)
create or replace function public.freight_promise_set_order(p_promise uuid, p_order uuid) returns text
language plpgsql security definer set search_path = public as $$
declare p public.freight_promises%rowtype; o public.orders%rowtype;
begin
  if not public.user_can_edit() then raise exception 'Only admins, managers and buyers set freight terms' using errcode = '42501'; end if;
  select * into p from public.freight_promises where id = p_promise;
  if p.id is null or not public.user_in_org(p.organization_id) then raise exception 'Not found' using errcode = '23503'; end if;
  if p_order is null then
    update public.freight_promises set status = 'not_an_order' where id = p.id;
    update public.tasks set done_at = now(), done_by = auth.uid(), closed_how = 'person', done_note = 'Not for one of our orders: set aside.' where id = p.task_id and done_at is null;
    return 'not_an_order';
  end if;
  select * into o from public.orders where id = p_order;
  if o.id is null or o.organization_id <> p.organization_id then raise exception 'Order not found' using errcode = '23503'; end if;
  update public.freight_promises set order_id = o.id where id = p.id;
  update public.tasks set done_by = auth.uid(), closed_how = 'person' where id = p.task_id and done_at is null;
  return public.freight_promise_apply(p.id, o.id, auth.uid());
end $$;
revoke execute on function public.freight_promise_set_order(uuid, uuid) from public, anon;
grant execute on function public.freight_promise_set_order(uuid, uuid) to authenticated, service_role;

-- the reader's queue: shared vendor mail of the last 12 months that talks about freight, newest first
create or replace function public.mail_freight_queue(p_org uuid, p_limit integer)
returns table (email_id uuid, direction text, vendor text, subject text, received_at timestamptz, body_text text)
language sql stable security definer set search_path = public as $$
  select e.id, e.direction, v.name, e.subject, e.received_at, left(e.body_text, 4000)
    from public.emails e join public.email_threads t on t.id = e.thread_id
    left join public.vendors v on v.id = coalesce(e.vendor_id, t.vendor_id)
   where e.organization_id = p_org and e.freight_read_at is null and e.copy_of is null and not coalesce(e.is_bulk, false)
     and e.direction in ('in', 'out') and (e.mailbox_id is null or t.shared_at is not null)
     and coalesce(e.vendor_id, t.vendor_id) is not null
     and e.received_at > now() - interval '12 months'
     and (coalesce(e.subject, '') || ' ' || coalesce(e.body_text, '')) ~* '(free (freight|ship)|freight|shipping (is|will be|charge|cost)|ship(s|ped)? (for )?free|prepaid|\mppd\M|f\.?o\.?b\.?|ffa)'
   order by e.received_at desc limit p_limit
$$;
revoke execute on function public.mail_freight_queue(uuid, integer) from public, anon, authenticated;
grant execute on function public.mail_freight_queue(uuid, integer) to service_role;

-- ---- back-check: every invoice already read ------------------------------------------------------------------------
select count(public.freight_issue_check(c.id)) as freight_differences_found
  from public.order_checks c where c.kind = 'invoice' and c.reading is not null and c.status not in ('not_paperwork', 'dismissed');
