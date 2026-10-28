-- 0264 — Dana, Oct 28 ("go on all 3, use 30 days"):
--   1. World Famous Sports SO 88198: the Feb 28 confirmation (SO-88198.pdf) and Maria's Oct 27 shipping / backorder
--      sheet (SO 88198.xlsx) are tied to the order that holds the SO 88198 invoices (I88198 … I88198-4). The sheet's
--      "which order?" check is finished: it is a shipping list, not a confirmation to compare line by line.
--   2. A backorder/delay email in a personal inbox makes its task only for that inbox's owner (private mail stays private).
--   3. Mail up to 30 days old makes the task (was 3), like proofs and credits.

set local lock_timeout = '5s';

update public.vendor_links set order_id = '1bcae7f1-9507-4a6f-b536-d8168c1ef022'
 where id in ('9375f8d6-7194-49ea-b81d-02c47653862c', 'a94d4953-a7c4-4cec-9ff4-262ac7389a2e') and order_id is null;
update public.order_checks set order_id = '1bcae7f1-9507-4a6f-b536-d8168c1ef022', status = 'done', outcome = 'no_email', working_at = null,
       read_note = 'Maria''s list of what is shipping and what is backordered on SO 88198, tied to the order (Dana, Oct 28). Item names: the spreadsheet Claude made Oct 28; 4 item numbers asked about in the email to Maria.'
 where id = '912d56eb-40e9-45ae-bada-f3951ea63233' and status not in ('done', 'dismissed');

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
     or e.received_at < now() - interval '30 days' then return null; end if;
  select * into t from public.email_threads where id = e.thread_id;
  -- a carrier's own notice (UPS "different date") is not the vendor's update
  if exists (select 1 from public.email_senders s where s.id = e.sender_id and s.kind = 'carrier') then return null; end if;
  select name into vn from public.vendors where id = e.vendor_id;
  select o.placed_by_id, o.po_number into who, po from public.orders o where o.id = e.order_id;
  if e.mailbox_id is not null and t.shared_at is null then
    -- private mail: only the inbox's owner gets it
    select owner_id into who from public.mailboxes where id = e.mailbox_id;
  else
    who := coalesce(who, t.owner_id, public.org_admin(e.organization_id));
  end if;
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

-- back-check for the wider window: vendor delay updates from the last 30 days
select public.vendor_delay_task(id) from public.emails where ship_status = 'exception' and direction = 'in' and received_at > now() - interval '30 days';
