-- 0365 — A Sent → Placed move VMS makes from a reply is dated by that reply, not by the day VMS read it (Dana, Nov 13: "an
-- order placed 1-19-26 (10 months ago) is showing as 'placed' as of today … Why is this old, closed and received order even
-- in my activity feed?"). On Nov 12 the new rule read eight old replies and stamped the moves with that day, so the
-- vendor activity feeds showed ten-month-old orders at the top. Back-check: those moves are re-dated by their reply.
-- The January Slippery Racer order VMS made from sent mail (SLIPPERY011926) is the same order as PO 6914 from Dana's sheet
-- (Dana, Nov 13: "it is the same order. we received the confirmation from sr on 1/20/26"): its emails, file and lines move
-- to 6914 and the duplicate goes.

create or replace function public.order_placed(p_order uuid, p_how text, p_email uuid default null) returns boolean
language plpgsql security definer set search_path = public as $$
declare v_when timestamptz;
begin
  -- the moment they acknowledged: the reply's own time when there is one, else now
  select received_at into v_when from public.emails where id = p_email;
  v_when := coalesce(v_when, now());
  update public.orders set status = 'awaiting_confirmation', ack_at = coalesce(ack_at, v_when), ack_how = coalesce(ack_how, p_how), ack_email_id = coalesce(ack_email_id, p_email)
   where id = p_order and status = 'open';
  if not found then return false; end if;
  -- the history row the status trigger just wrote carries the reply's date, so feeds and the order page show when it happened
  update public.order_status_history set changed_at = v_when
   where id = (select id from public.order_status_history where order_id = p_order and to_status = 'awaiting_confirmation' order by changed_at desc limit 1)
     and changed_at > v_when;
  return true;
end $$;
revoke execute on function public.order_placed(uuid, text, uuid) from public, anon, authenticated;

-- back-check: moves already made from a reply are dated by the reply
with fix as (
  select h.id as hist_id, o.id as order_id, e.received_at
    from public.order_status_history h
    join public.orders o on o.id = h.order_id
    join public.emails e on e.id = o.ack_email_id
   where o.ack_how = 'reply' and h.to_status = 'awaiting_confirmation' and h.changed_at > e.received_at + interval '1 day'
), h as (update public.order_status_history s set changed_at = f.received_at from fix f where s.id = f.hist_id returning s.id)
update public.orders o set ack_at = f.received_at from fix f where o.id = f.order_id;

-- SLIPPERY011926 (made from the Jan 19-21 "Missing items" emails) is PO 6914: merge and remove the duplicate
do $$
declare dup uuid; keep uuid; v_ack uuid; v_when timestamptz;
begin
  select id into dup from public.orders where po_number = 'SLIPPERY011926' and source = 'email';
  select id into keep from public.orders where po_number = '6914' and vendor_id = (select vendor_id from public.orders where id = dup);
  if dup is null or keep is null then return; end if;
  select ack_email_id, ack_at into v_ack, v_when from public.orders where id = dup;
  update public.emails set order_id = keep where order_id = dup;
  update public.vendor_links set order_id = keep where order_id = dup;
  update public.order_ack_reads set order_id = keep where order_id = dup;
  update public.tasks set order_id = keep where order_id = dup;
  update public.email_drafts set order_id = keep where order_id = dup;
  update public.order_checks set order_id = keep where order_id = dup;
  if not exists (select 1 from public.order_lines where order_id = keep) then update public.order_lines set order_id = keep where order_id = dup; end if;
  update public.orders set ack_email_id = coalesce(ack_email_id, v_ack), ack_at = coalesce(ack_at, v_when), ack_how = coalesce(ack_how, 'reply'),
         notes = concat_ws(E'\n', nullif(notes, ''), 'Our Jan 19-21 "Missing items" emails and the file 1-20-26 Slippery Racer Order.xlsx belong to this order (Marcy confirmed it Jan 20, 2026). VMS had made a second order from them; merged here Nov 13, 2026 at Dana''s word.')
   where id = keep;
  delete from public.orders where id = dup;   -- its status history goes with it
end $$;
