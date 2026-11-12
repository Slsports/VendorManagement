-- 0359 — Sent, then Placed, then Confirmed (Dana, Nov 12: "'Placed' isnt exactly accurate - that should be 'sent' - I had
-- to resend to a couple different people the slippery racer order today because Marcy never responded. So Placed doesnt
-- exist until its been acknowledge with a reply that they received it. And the its not 'confirmed until the email us
-- confirmation." … "yes, two days is good for reminder" … "whoever sent it, go").
--   • 'open' is shown as **Sent** (we emailed the order, nobody answered yet); 'awaiting_confirmation' as **Placed** (they
--     said they received it). Confirmed stays: their confirmation, reviewed.
--   • Sent → Placed: Claude reads the vendor's replies on the order's email conversation (sent-orders, every minute); a
--     reply saying they got it moves it, with that email one click away (orders.ack_email_id). Their confirmation filed on
--     the order does too. **They received it** on the order page for a call or a reply elsewhere.
--   • Still Sent 2 business days after our latest order email: a task for whoever sent it, "No reply yet: …", with a
--     follow-up email in their Drafts; it closes itself when the order moves on (reply, confirmation, any status).
--   • Back-check: open orders from Dana's sheets (Seasonal Buying Guide, Placed Order Summary "1-Open Orders") are Placed;
--     open orders from email wait for Claude's reading of their replies. Reminders only for order emails of the last 30 days.
set local lock_timeout = '5s';

alter table public.orders add column if not exists ack_at timestamptz;
alter table public.orders add column if not exists ack_email_id uuid references public.emails(id) on delete set null;
alter table public.orders add column if not exists ack_how text check (ack_how in ('reply', 'person', 'confirmation', 'sheet'));
comment on column public.orders.ack_at is 'When the vendor acknowledged the order (Sent → Placed; Dana, Nov 12).';
comment on column public.orders.ack_email_id is 'Their reply saying they received the order.';

-- Claude's reading of each reply, once
create table if not exists public.order_ack_reads (
  email_id        uuid primary key references public.emails(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  order_id        uuid not null references public.orders(id) on delete cascade,
  received        boolean not null,
  read_at         timestamptz not null default now()
);
comment on table public.order_ack_reads is 'Replies on an order''s conversation Claude read for "we received your order" (Dana, Nov 12).';
alter table public.order_ack_reads enable row level security;
drop policy if exists order_ack_reads_read on public.order_ack_reads;
create policy order_ack_reads_read on public.order_ack_reads for select to authenticated using (public.user_in_org(organization_id));
grant select on public.order_ack_reads to authenticated;
grant all on public.order_ack_reads to service_role;

/** Our latest order email on an order (the one the vendor is answering). */
create or replace function public.order_sent_email(p_order uuid) returns uuid
language sql stable security definer set search_path = public as $$
  select e.id from public.emails e where e.order_id = p_order and e.direction = 'out' order by e.received_at desc limit 1
$$;
revoke execute on function public.order_sent_email(uuid) from public, anon, authenticated;

/** Vendor replies to read: inbound mail on a Sent order's conversation after our first order email, not read yet. */
create or replace function public.order_ack_candidates(p_limit integer default 15)
returns table (email_id uuid, order_id uuid, organization_id uuid, po text, vendor text, from_email text, subject text, body text)
language sql stable security definer set search_path = public as $$
  select r.id, o.id, o.organization_id, o.po_number, v.name, r.from_email, r.subject, left(coalesce(r.body_text, r.snippet, ''), 3000)
    from public.orders o
    join public.vendors v on v.id = o.vendor_id
    join lateral (select min(e.received_at) as first_at, array_agg(distinct e.thread_id) as threads from public.emails e
                   where e.order_id = o.id and e.direction = 'out' and e.thread_id is not null) s on s.first_at is not null
    join public.emails r on r.thread_id = any (s.threads) and r.direction = 'in' and r.received_at > s.first_at
   where o.status = 'open'
     and not exists (select 1 from public.order_ack_reads a where a.email_id = r.id)
   order by r.received_at
   limit p_limit
$$;
revoke execute on function public.order_ack_candidates(integer) from public, anon, authenticated;
grant execute on function public.order_ack_candidates(integer) to service_role;

/** Sent → Placed (a reply, a person, their confirmation, or Dana's sheet). Closes the "No reply yet" task. */
create or replace function public.order_placed(p_order uuid, p_how text, p_email uuid default null) returns boolean
language plpgsql security definer set search_path = public as $$
begin
  update public.orders set status = 'awaiting_confirmation', ack_at = coalesce(ack_at, now()), ack_how = coalesce(ack_how, p_how), ack_email_id = coalesce(ack_email_id, p_email)
   where id = p_order and status = 'open';
  return found;
end $$;
revoke execute on function public.order_placed(uuid, text, uuid) from public, anon, authenticated;

create or replace function public.order_ack_save(p_email uuid, p_order uuid, p_received boolean) returns boolean
language plpgsql security definer set search_path = public as $$
declare v_org uuid;
begin
  select organization_id into v_org from public.orders where id = p_order;
  if v_org is null then return false; end if;
  insert into public.order_ack_reads (email_id, organization_id, order_id, received) values (p_email, v_org, p_order, coalesce(p_received, false))
  on conflict (email_id) do nothing;
  if coalesce(p_received, false) then return public.order_placed(p_order, 'reply', p_email); end if;
  return false;
end $$;
revoke execute on function public.order_ack_save(uuid, uuid, boolean) from public, anon, authenticated;
grant execute on function public.order_ack_save(uuid, uuid, boolean) to service_role;

/** They received it (a phone call, a reply in another mailbox): the order page's button. */
create or replace function public.order_mark_placed(p_order uuid) returns boolean
language plpgsql security definer set search_path = public as $$
declare v_org uuid;
begin
  select organization_id into v_org from public.orders where id = p_order;
  if v_org is null or not (public.user_in_org(v_org) and public.user_can_edit()) then raise exception 'Order not found' using errcode = '42501'; end if;
  return public.order_placed(p_order, 'person', null);
end $$;
revoke execute on function public.order_mark_placed(uuid) from public, anon;
grant execute on function public.order_mark_placed(uuid) to authenticated;

-- their confirmation filed on a Sent order: it is Placed (Confirmed comes when the confirmation is reviewed)
create or replace function public.vendor_links_confirmation_places() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.kind = 'confirmation' and new.order_id is not null then perform public.order_placed(new.order_id, 'confirmation', new.email_id); end if;
  return null;
end $$;
revoke execute on function public.vendor_links_confirmation_places() from public, anon, authenticated;
drop trigger if exists vendor_links_confirmation_places on public.vendor_links;
create trigger vendor_links_confirmation_places after insert or update of order_id, kind on public.vendor_links
  for each row execute function public.vendor_links_confirmation_places();

-- an order that moves on from Sent: its reminder closes and an unsent follow-up goes away
create or replace function public.orders_noreply_done() returns trigger
language plpgsql security definer set search_path = public as $$
declare t record;
begin
  if old.status = 'open' and new.status is distinct from 'open' then
    for t in select id, draft_id from public.tasks where organization_id = new.organization_id and auto_key = 'noreply:' || new.id and done_at is null loop
      update public.tasks set done_at = now(), done_note = case
          when new.ack_how = 'reply' then 'They replied that they received the order.'
          when new.ack_how = 'confirmation' then 'Their confirmation came in.'
          when new.ack_how = 'person' then 'Marked as received by the vendor.'
          else 'The order is ' || new.status || ' now.' end
       where id = t.id;
      delete from public.email_drafts where id = t.draft_id and gmail_draft_id is null;
    end loop;
  end if;
  return null;
end $$;
revoke execute on function public.orders_noreply_done() from public, anon, authenticated;
drop trigger if exists orders_noreply_done on public.orders;
create trigger orders_noreply_done after update of status on public.orders for each row execute function public.orders_noreply_done();

/** Still Sent 2 business days after our latest order email (of the last 30 days): a task and a follow-up for whoever sent it. */
create or replace function public.order_noreply_reminders(p_org uuid) returns integer
language plpgsql security definer set search_path = public as $$
declare o record; e public.emails%rowtype; v_who uuid; v_box uuid; v_draft uuid; v_po text; n integer := 0;
begin
  for o in select x.*, v.name as vname from public.orders x join public.vendors v on v.id = x.vendor_id
            where x.organization_id = p_org and x.status = 'open'
              and not exists (select 1 from public.tasks t where t.organization_id = p_org and t.auto_key = 'noreply:' || x.id) loop
    select * into e from public.emails where id = public.order_sent_email(o.id);
    continue when e.id is null or e.received_at < now() - interval '30 days' or public.add_business_days(e.received_at, 2) > now();
    v_box := e.mailbox_id;
    v_who := coalesce((select owner_id from public.mailboxes where id = v_box), o.placed_by_id, public.org_admin(p_org));
    continue when v_who is null;
    v_po := coalesce('PO ' || nullif(trim(o.po_number), ''), 'our order');
    insert into public.email_drafts (organization_id, owner_id, created_by, to_emails, cc_emails, subject, body, thread_id, reply_to_email_id, vendor_id, order_id, mailbox_id, note)
    values (p_org, v_who, v_who, e.to_emails, e.cc_emails,
            case when e.subject ilike 'Re:%' then e.subject else 'Re: ' || coalesce(e.subject, v_po) end,
            'Hi,' || E'\n\n' || 'I''m following up on ' || v_po || ', which I sent on ' || to_char(e.received_at at time zone 'America/Los_Angeles', 'FMMM/FMDD') || '. Could you reply to let me know you received it?' || E'\n\nThanks,',
            e.thread_id, e.id, o.vendor_id, o.id, v_box,
            'Follow-up: no reply to the order for ' || coalesce(o.vname, 'the vendor') || ', ' || v_po || ' (VMS made this draft after 2 business days; send it as is, change it, or add someone)')
    returning id into v_draft;
    insert into public.tasks (organization_id, title, notes, due_date, remind_at, assigned_to, created_by, vendor_id, order_id, thread_id, draft_id, auto_key)
    values (p_org, left('No reply yet: ' || coalesce(o.vname, 'the vendor') || ', ' || v_po, 200),
            'You sent the order on ' || to_char(e.received_at at time zone 'America/Los_Angeles', 'Mon FMDD') || ' and nobody has answered in 2 business days. A follow-up email is ready in your Drafts (Go to it): send it as is, change it, or add someone else. This task closes itself when they reply that they got it or their confirmation comes in.',
            current_date, now(), v_who, v_who, o.vendor_id, o.id, e.thread_id, v_draft, 'noreply:' || o.id)
    on conflict (organization_id, auto_key) where auto_key is not null do nothing;
    n := n + 1;
  end loop;
  return n;
end $$;
revoke execute on function public.order_noreply_reminders(uuid) from public, anon, authenticated;
grant execute on function public.order_noreply_reminders(uuid) to service_role;

do $$ begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule(jobid) from cron.job where jobname = 'order-noreply-reminders';
    perform cron.schedule('order-noreply-reminders', '23 * * * *', $job$select public.order_noreply_reminders(id) from public.organizations$job$);
  end if;
end $$;

-- ---- back-check ------------------------------------------------------------------------------------------------------
-- open orders from Dana's own sheets of placed orders are Placed
update public.orders set status = 'awaiting_confirmation', ack_how = 'sheet'
 where status = 'open' and source in ('order_guide', 'placed_order_summary');
-- a confirmation already filed on a Sent order
do $$ declare l record; begin
  for l in select distinct on (x.order_id) x.order_id, x.email_id from public.vendor_links x join public.orders o on o.id = x.order_id
            where x.kind = 'confirmation' and o.status = 'open' order by x.order_id, x.created_at loop
    perform public.order_placed(l.order_id, 'confirmation', l.email_id);
  end loop;
end $$;
