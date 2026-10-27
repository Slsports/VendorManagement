-- 0255 — Credit tracking for Trevor (Dana, Oct 27): "when he, or anyone else on our team, asks for a credit from a
-- vendor, it should notify him (or whoever requested the credit) if 7 days goes by and there is no email reply with a
-- credit doc attached. Create a follow up email draft with the task reminder … Once the credit is received, the next
-- check (IF they are a WWD vendor) is that VMS confirms the credit made it to Edenred … then VMS will mark as completed
-- on Trevor's tasks and mark 'received on Edenred' on the document itself."
--
--   • credit_requests: one per outgoing orders@ email that asks a vendor for a credit (Claude reads them, gmail-sync).
--     A task for the person who signed it (Trevor when unsure): first reminder after 7 days, then weekly
--     (remind_rule 'credit'); the reminder brings a follow-up email draft (credit_request_followup, task-reminders).
--   • A credit that lands for that vendor (same conversation, or the same invoice number or amount after the request)
--     marks the request Received (credit_requests_match_link). A WWD vendor's task waits for Edenred; another vendor's
--     task says the credit is in and waits for the person (Dana still to decide that step).
--   • An Edenred credit (wwd_invoices, source edenred) for the same paper, invoice number or amount marks the paper
--     "On Edenred <posted date>" (vendor_links.on_edenred_on) and closes the request's task with a plain done_note.
--     Credits with no request get the tag too, no task.

set local lock_timeout = '5s';

alter table public.vendor_links add column if not exists on_edenred_on date;
comment on column public.vendor_links.on_edenred_on is 'A credit that Edenred shows (Trevor''s uploads): the date Edenred posted it (Dana, Oct 27).';
alter table public.emails add column if not exists credit_read_at timestamptz;
comment on column public.emails.credit_read_at is 'Claude read this outgoing email for a credit request (Dana, Oct 27).';

alter table public.tasks drop constraint if exists tasks_remind_rule_check;
alter table public.tasks add constraint tasks_remind_rule_check check (remind_rule in ('ask', 'cdtfa', 'credit'));

create table if not exists public.credit_requests (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations(id) on delete cascade,
  email_id         uuid not null references public.emails(id) on delete cascade unique,
  thread_id        uuid references public.email_threads(id) on delete set null,
  vendor_id        uuid not null references public.vendors(id) on delete cascade,
  requested_by     uuid not null references public.profiles(id),
  requested_on     date not null,
  what             text not null default '',
  invoice_number   text,
  amount           numeric(12,2),
  status           text not null default 'open' check (status in ('open', 'received', 'on_edenred', 'closed')),
  credit_link_id   uuid references public.vendor_links(id) on delete set null,
  received_on      date,
  wwd_invoice_id   uuid references public.wwd_invoices(id) on delete set null,
  on_edenred_on    date,
  task_id          uuid references public.tasks(id) on delete set null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
comment on table public.credit_requests is 'Credits we asked vendors for (an outgoing orders@ email), tracked to Received and On Edenred (Dana, Oct 27).';
create index if not exists credit_requests_vendor_open on public.credit_requests (vendor_id) where status in ('open', 'received');
alter table public.credit_requests enable row level security;
drop policy if exists credit_requests_read on public.credit_requests;
create policy credit_requests_read on public.credit_requests for select to authenticated using (public.user_in_org(organization_id));
drop policy if exists credit_requests_edit on public.credit_requests;
create policy credit_requests_edit on public.credit_requests for update to authenticated using (public.user_in_org(organization_id) and public.user_can_edit()) with check (public.user_in_org(organization_id));
grant select, update on public.credit_requests to authenticated;
grant all on public.credit_requests to service_role;
drop trigger if exists credit_requests_touch on public.credit_requests;
create trigger credit_requests_touch before update on public.credit_requests for each row execute function public.set_updated_at();

create or replace function public.vendor_is_wwd(p_vendor uuid) returns boolean language sql stable set search_path = public as $$
  select exists (select 1 from public.vendor_billing_routes r where r.vendor_id = p_vendor and r.route = 'worldwide')
$$;
grant execute on function public.vendor_is_wwd(uuid) to authenticated, service_role;

-- Who signed our email: a first name from the signature matched to our people; else Trevor; else the admin.
create or replace function public.credit_request_who(p_org uuid, p_signer text) returns uuid language sql stable set search_path = public as $$
  select coalesce(
    (select id from public.profiles where organization_id = p_org and is_active and nullif(trim(p_signer), '') is not null
       and lower(split_part(full_name, ' ', 1)) = lower(split_part(trim(p_signer), ' ', 1)) limit 1),
    (select id from public.profiles where organization_id = p_org and is_active and email = 'trevor@shaverlakesports.com' limit 1),
    public.org_admin(p_org))
$$;
revoke execute on function public.credit_request_who(uuid, text) from public, anon;
grant execute on function public.credit_request_who(uuid, text) to authenticated, service_role;

-- The request and its task, once per email. Returns the request id (null when the email is not a vendor email).
create or replace function public.credit_request_make(p_email uuid, p_what text, p_invoice text, p_amount numeric, p_signer text)
returns uuid language plpgsql security definer set search_path = public as $$
declare e record; v_who uuid; v_req uuid; v_task uuid; v_vn text; v_title text; v_wwd boolean;
begin
  select m.id, m.organization_id, m.thread_id, m.received_at, coalesce(m.vendor_id, t.vendor_id) as vendor_id
    into e from public.emails m left join public.email_threads t on t.id = m.thread_id where m.id = p_email and m.direction = 'out' and m.mailbox_id is null;
  if e.id is null or e.vendor_id is null then return null; end if;
  select id into v_req from public.credit_requests where email_id = p_email;
  if v_req is not null then return v_req; end if;
  v_who := public.credit_request_who(e.organization_id, p_signer);
  if v_who is null then return null; end if;
  select name into v_vn from public.vendors where id = e.vendor_id;
  v_wwd := public.vendor_is_wwd(e.vendor_id);
  insert into public.credit_requests (organization_id, email_id, thread_id, vendor_id, requested_by, requested_on, what, invoice_number, amount)
    values (e.organization_id, p_email, e.thread_id, e.vendor_id, v_who, (e.received_at at time zone 'America/Los_Angeles')::date,
            left(coalesce(nullif(trim(p_what), ''), 'a credit'), 160), nullif(trim(p_invoice), ''), p_amount)
    returning id into v_req;
  v_title := left('Credit from ' || coalesce(v_vn, 'the vendor') || ': ' || coalesce(nullif(trim(p_what), ''), 'what you asked for')
             || case when nullif(trim(p_invoice), '') is not null then ' (invoice ' || trim(p_invoice) || ')' else '' end, 200);
  insert into public.tasks (organization_id, title, notes, due_date, remind_at, remind_rule, assigned_to, created_by, vendor_id, thread_id, auto_key, area)
    values (e.organization_id, v_title,
            'You asked ' || coalesce(v_vn, 'the vendor') || ' for this credit on ' || to_char(e.received_at at time zone 'America/Los_Angeles', 'Mon FMDD') || '. '
            || 'VMS watches for their reply with the credit; if 7 days go by with nothing, it reminds you weekly and puts a follow-up email in your Drafts. '
            || case when v_wwd then 'Once the credit is in, VMS checks it reached Edenred from your uploads and finishes this task on its own.'
                    else 'Once the credit is in, VMS marks it here for you to check and finish.' end,
            (e.received_at at time zone 'America/Los_Angeles')::date + 7, e.received_at + interval '7 days', 'credit',
            v_who, v_who, e.vendor_id, e.thread_id, 'credit_req:' || v_req, 'general')
    returning id into v_task;
  update public.credit_requests set task_id = v_task where id = v_req;
  return v_req;
end $$;
revoke execute on function public.credit_request_make(uuid, text, text, numeric, text) from public, anon, authenticated;
grant execute on function public.credit_request_make(uuid, text, text, numeric, text) to service_role;

-- The follow-up email, ready in the person's Drafts when the 7-day reminder goes (task-reminders calls it). Once.
create or replace function public.credit_request_followup(p_task uuid) returns uuid language plpgsql security definer set search_path = public as $$
declare t public.tasks%rowtype; r public.credit_requests%rowtype; m public.emails%rowtype; v_draft uuid; v_vn text; v_first text; v_last uuid;
begin
  select * into t from public.tasks where id = p_task and done_at is null and auto_key like 'credit_req:%';
  if t.id is null or t.draft_id is not null then return t.draft_id; end if;
  select * into r from public.credit_requests where id = substr(t.auto_key, 12)::uuid;
  if r.id is null or r.status <> 'open' then return null; end if;
  select * into m from public.emails where id = r.email_id;
  select name into v_vn from public.vendors where id = r.vendor_id;
  select split_part(full_name, ' ', 1) into v_first from public.profiles where id = t.assigned_to;
  select id into v_last from public.emails where thread_id = r.thread_id and direction <> 'internal' order by received_at desc limit 1;
  insert into public.email_drafts (organization_id, owner_id, created_by, to_emails, cc_emails, subject, body, thread_id, reply_to_email_id, vendor_id, note)
    values (r.organization_id, t.assigned_to, t.assigned_to, m.to_emails, coalesce(m.cc_emails, '{}'),
            case when m.subject ilike 'Re:%' then m.subject else 'Re: ' || coalesce(m.subject, 'Credit request') end,
            'Hi,' || E'\n\n' || 'Following up on the credit we asked for on ' || to_char(m.received_at at time zone 'America/Los_Angeles', 'Mon FMDD')
            || case when r.invoice_number is not null then ' for invoice ' || r.invoice_number else '' end
            || case when r.amount is not null then ' ($' || to_char(r.amount, 'FM999,999,990.00') || ')' else '' end
            || ' (' || r.what || E'). We have not seen the credit memo yet. Could you send it over, or let us know when it will be issued?\n\nThanks,\n' || coalesce(v_first, ''),
            r.thread_id, coalesce(v_last, r.email_id), r.vendor_id,
            'Follow-up on the credit from ' || coalesce(v_vn, 'the vendor') || ' (VMS made this draft with the 7-day reminder; send it or change it)')
    returning id into v_draft;
  update public.tasks set draft_id = v_draft where id = p_task;
  return v_draft;
end $$;
revoke execute on function public.credit_request_followup(uuid) from public, anon;
grant execute on function public.credit_request_followup(uuid) to authenticated, service_role;

-- A request is Received: the task stops reminding; a WWD vendor's waits for Edenred, another vendor's waits for the person.
create or replace function public.credit_request_received(p_req uuid, p_link uuid, p_on date) returns void language plpgsql security definer set search_path = public as $$
declare r public.credit_requests%rowtype; v_wwd boolean; v_vn text;
begin
  select * into r from public.credit_requests where id = p_req and status = 'open';
  if r.id is null then return; end if;
  v_wwd := public.vendor_is_wwd(r.vendor_id);
  select name into v_vn from public.vendors where id = r.vendor_id;
  update public.credit_requests set status = 'received', credit_link_id = p_link, received_on = p_on where id = p_req;
  update public.tasks set remind_at = null, remind_rule = null, reminded_at = null, reminder_seen_at = null,
         notes = 'The credit from ' || coalesce(v_vn, 'the vendor') || ' came in on ' || to_char(p_on, 'Mon FMDD') || ' and is in the vendor''s Credits folder, marked Received. '
                 || case when v_wwd then 'It is a WWD vendor: VMS is watching your Edenred uploads for it and will finish this task when it shows there.'
                         else 'Not a WWD vendor: check it against the invoice, then mark this done.' end
   where id = r.task_id and done_at is null;
  delete from public.email_drafts where id = (select draft_id from public.tasks where id = r.task_id) and gmail_draft_id is null;
  update public.tasks set draft_id = null where id = r.task_id and draft_id is not null and not exists (select 1 from public.email_drafts d where d.id = public.tasks.draft_id);
end $$;
revoke execute on function public.credit_request_received(uuid, uuid, date) from public, anon, authenticated;
grant execute on function public.credit_request_received(uuid, uuid, date) to service_role;

-- On Edenred: the paper gets its tag; a request pointing at the paper (or matching the Edenred credit) closes its task.
create or replace function public.credit_on_edenred(p_link uuid, p_wwd uuid, p_on date) returns void language plpgsql security definer set search_path = public as $$
declare r public.credit_requests%rowtype; v_vn text; w public.wwd_invoices%rowtype;
begin
  select * into w from public.wwd_invoices where id = p_wwd;
  update public.vendor_links set on_edenred_on = coalesce(on_edenred_on, p_on) where id = p_link and kind = 'credit';
  for r in select * from public.credit_requests where status in ('open', 'received')
            and (credit_link_id = p_link or (vendor_id = w.vendor_id and credit_link_id is null and (
                   (invoice_number is not null and public.vin_norm(invoice_number) = public.vin_norm(w.vendor_invoice_number))
                or (amount is not null and w.amount is not null and abs(w.amount) = amount)))) loop
    select name into v_vn from public.vendors where id = r.vendor_id;
    update public.credit_requests set status = 'on_edenred', wwd_invoice_id = p_wwd, on_edenred_on = p_on,
           credit_link_id = coalesce(credit_link_id, p_link), received_on = coalesce(received_on, p_on) where id = r.id;
    update public.tasks set done_at = now(), closed_how = 'vms', remind_at = null, remind_rule = null,
           done_note = 'The credit from ' || coalesce(v_vn, 'the vendor') || ' is on Edenred (posted ' || to_char(p_on, 'Mon FMDD, YYYY') || ', WWD Seq # ' || w.seq
                       || case when w.vendor_invoice_number is not null then ', credit ' || w.vendor_invoice_number else '' end
                       || '). VMS saw it in the Edenred upload; the paper in the vendor''s Credits folder is tagged On Edenred.'
     where id = r.task_id and done_at is null;
    delete from public.email_drafts where id = (select draft_id from public.tasks where id = r.task_id) and gmail_draft_id is null;
  end loop;
end $$;
revoke execute on function public.credit_on_edenred(uuid, uuid, date) from public, anon, authenticated;
grant execute on function public.credit_on_edenred(uuid, uuid, date) to service_role;

-- A credit paper lands: does it answer an open request (same conversation, else same invoice number or amount, after the request)?
-- And does Edenred already show it?
create or replace function public.credit_requests_match_link() returns trigger language plpgsql security definer set search_path = public as $$
declare v_req uuid; v_thread uuid; v_on date; w record;
begin
  if new.kind <> 'credit' or new.vendor_id is null then return null; end if;
  if tg_op = 'UPDATE' and old.kind = 'credit' and old.doc_number is not distinct from new.doc_number and old.doc_total is not distinct from new.doc_total then return null; end if;
  v_thread := public.document_thread(new);
  v_on := coalesce(new.credit_received_on, new.received_at, current_date);
  select id into v_req from public.credit_requests r
   where r.vendor_id = new.vendor_id and r.status = 'open' and r.requested_on <= v_on
   order by (v_thread is not null and r.thread_id = v_thread) desc,
            (r.invoice_number is not null and public.vin_norm(r.invoice_number) = public.vin_norm(new.doc_number)) desc,
            (r.amount is not null and new.doc_total is not null and abs(new.doc_total) = r.amount) desc, r.requested_on desc
   limit 1;
  if v_req is not null then
    -- only a real match counts: the conversation, the invoice number or the amount
    if exists (select 1 from public.credit_requests r where r.id = v_req and (
         (v_thread is not null and r.thread_id = v_thread)
      or (r.invoice_number is not null and public.vin_norm(r.invoice_number) = public.vin_norm(new.doc_number))
      or (r.amount is not null and new.doc_total is not null and abs(new.doc_total) = r.amount))) then
      perform public.credit_request_received(v_req, new.id, v_on);
    end if;
  end if;
  select i.id, i.posted_date, i.wwd_date into w from public.wwd_invoices i
   where i.vendor_id = new.vendor_id and i.kind = 'credit' and 'edenred' = any (i.sources)
     and (i.document_id = new.id
       or (new.doc_number is not null and public.vin_norm(i.vendor_invoice_number) = public.vin_norm(new.doc_number))
       or (new.doc_total is not null and i.amount is not null and abs(i.amount) = abs(new.doc_total)))
   order by (i.document_id = new.id) desc, i.posted_date desc nulls last limit 1;
  if w.id is not null then perform public.credit_on_edenred(new.id, w.id, coalesce(w.posted_date, w.wwd_date, current_date)); end if;
  return null;
end $$;
revoke execute on function public.credit_requests_match_link() from public, anon, authenticated;
drop trigger if exists credit_requests_match_link on public.vendor_links;
create trigger credit_requests_match_link after insert or update of kind, doc_number, doc_total, vendor_id on public.vendor_links
  for each row execute function public.credit_requests_match_link();

-- An Edenred credit arrives (Trevor's upload): the paper it points at, else the paper with its number or amount, gets the tag; the request closes.
create or replace function public.credit_requests_match_wwd() returns trigger language plpgsql security definer set search_path = public as $$
declare v_link uuid; v_on date;
begin
  if new.kind <> 'credit' or not ('edenred' = any (new.sources)) or new.vendor_id is null then return null; end if;
  v_on := coalesce(new.posted_date, new.wwd_date, current_date);
  select l.id into v_link from public.vendor_links l
   where l.vendor_id = new.vendor_id and l.kind = 'credit'
     and (l.id = new.document_id
       or (new.vendor_invoice_number is not null and public.vin_norm(l.doc_number) = public.vin_norm(new.vendor_invoice_number))
       or (new.amount is not null and l.doc_total is not null and abs(l.doc_total) = abs(new.amount)))
   order by (l.id = new.document_id) desc, l.created_at desc limit 1;
  perform public.credit_on_edenred(v_link, new.id, v_on);
  return null;
end $$;
revoke execute on function public.credit_requests_match_wwd() from public, anon, authenticated;
drop trigger if exists credit_requests_match_wwd on public.wwd_invoices;
create trigger credit_requests_match_wwd after insert or update of kind, sources, document_id, vendor_id, vendor_invoice_number, amount on public.wwd_invoices
  for each row execute function public.credit_requests_match_wwd();

-- Outgoing orders@ vendor mail Claude has not read for a credit request yet (last 60 days, newest first).
create or replace function public.mail_credit_queue(p_org uuid, p_limit integer default 10)
returns table (email_id uuid, subject text, body_text text, sent_at timestamptz, vendor text, to_emails text[])
language sql stable security definer set search_path = public as $$
  select e.id, e.subject, left(e.body_text, 3000), e.received_at, v.name, e.to_emails
    from public.emails e
    join public.email_threads t on t.id = e.thread_id
    left join public.vendors v on v.id = coalesce(e.vendor_id, t.vendor_id)
   where e.organization_id = p_org and e.direction = 'out' and e.credit_read_at is null
     and e.mailbox_id is null and t.mailbox_id is null and t.deleted_at is null
     and coalesce(e.vendor_id, t.vendor_id) is not null
     and e.received_at > now() - interval '60 days'
   order by e.received_at desc
   limit p_limit
$$;
revoke execute on function public.mail_credit_queue(uuid, integer) from public, anon, authenticated;
grant execute on function public.mail_credit_queue(uuid, integer) to service_role;

-- the Credits folder refreshes live
do $$ begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') and not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'credit_requests') then
    alter publication supabase_realtime add table public.credit_requests;
  end if;
end $$;

-- Back-check: every credit paper Edenred already shows gets its tag now.
update public.vendor_links l set on_edenred_on = coalesce(w.posted_date, w.wwd_date)
  from public.wwd_invoices w
 where w.document_id = l.id and l.kind = 'credit' and w.kind = 'credit' and 'edenred' = any (w.sources) and l.on_edenred_on is null;

-- The reminder rhythm: a credit reminds weekly (task_next_remind already does that when the due date is past).
comment on column public.tasks.remind_rule is 'ask / cdtfa / credit: after each reminder the next one is set by task_next_remind (weekly, 3 days before, on the day).';
