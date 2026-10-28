-- 0263 — A vendor's backorder or delay update makes a task (Dana, Oct 28): Maria's "items being processed / backordered,
-- busy season delays" email for SO 88198 was filed with no task and no reminder. "It should go to whoever placed the
-- order, in this case, it was me and yes, go."
--   • When the reply check marks a vendor's own email (not a carrier's notice) as a shipping problem (ship_status
--     'exception': backorders, delays, can't ship), the person who placed its order gets a task, reminded now (their
--     reminder settings and text hours), that opens the email. No order on it: the conversation's owner, else Dana.
--   • Shared mail only (private inboxes stay private). Mail older than 3 days makes no task (history isn't a to-do).
--   • Back-check: Maria's Oct 27 email.

set local lock_timeout = '5s';

create or replace function public.vendor_delay_task(p_email uuid) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  e   public.emails%rowtype;
  t   public.email_threads%rowtype;
  vn  text;
  who uuid;
  po  text;
  v_id uuid;
begin
  select * into e from public.emails where id = p_email;
  if e.id is null or e.direction <> 'in' or e.ship_status is distinct from 'exception' or e.vendor_id is null
     or e.received_at < now() - interval '3 days' then return null; end if;
  select * into t from public.email_threads where id = e.thread_id;
  if e.mailbox_id is not null and t.shared_at is null then return null; end if;
  -- a carrier's own notice (UPS "different date") is not the vendor's update
  if exists (select 1 from public.email_senders s where s.id = e.sender_id and s.kind = 'carrier') then return null; end if;
  select name into vn from public.vendors where id = e.vendor_id;
  select o.placed_by_id, o.po_number into who, po from public.orders o where o.id = e.order_id;
  who := coalesce(who, t.owner_id, public.org_admin(e.organization_id));
  if who is null then return null; end if;
  insert into public.tasks (organization_id, title, notes, due_date, remind_at, assigned_to, vendor_id, order_id, thread_id, auto_key)
  values (e.organization_id,
          left(format('%s: backorders or shipping delays%s', coalesce(vn, 'Vendor'), coalesce(' (' || coalesce(po, nullif(e.subject, '')) || ')', '')), 200),
          concat_ws(' ', nullif(e.reply_note, ''), 'Click to open their email.'),
          (now() at time zone 'America/Los_Angeles')::date, now(), who, e.vendor_id, e.order_id, e.thread_id, 'shipupd:' || e.id)
  on conflict (organization_id, auto_key) where auto_key is not null do nothing
  returning id into v_id;
  return v_id;
end;
$$;
revoke execute on function public.vendor_delay_task(uuid) from public, anon, authenticated;

create or replace function public.emails_vendor_delay_task() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.ship_status = 'exception' and old.ship_status is distinct from 'exception' then
    perform public.vendor_delay_task(new.id);
  end if;
  return null;
end;
$$;
revoke execute on function public.emails_vendor_delay_task() from public, anon, authenticated;
drop trigger if exists emails_vendor_delay_task on public.emails;
create trigger emails_vendor_delay_task after update of ship_status on public.emails for each row execute function public.emails_vendor_delay_task();

-- back-check: vendor delay updates from the last 3 days (Maria's SO 88198)
select public.vendor_delay_task(id) from public.emails where ship_status = 'exception' and direction = 'in' and received_at > now() - interval '3 days';
