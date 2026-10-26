-- 0243 — An order email from before a request can't fill it (Oct 26 back-check): Annette's Oct 21 request (counterfeit
-- markers, index card pockets, 5x8 note pads) was marked arrived from a Walmart delivery of Oct 13. Her items are on
-- Dana's Amazon orders of Oct 25 (113-5153837-1709816, 113-8992474-9629024), so it is put on that order. She is not
-- emailed again: the Oct 25 email about her Oct 5 request named the same Amazon orders.

set local lock_timeout = '5s';

create or replace function public.supply_from_confirmation(p_email uuid, p_kind text, p_requests uuid[], p_seller text, p_order text, p_expected date, p_total numeric, p_tracking text)
returns integer language plpgsql security definer set search_path = public as $$
declare
  e       public.emails%rowtype;
  r       public.supply_requests%rowtype;
  v_priv  boolean;
  n       integer := 0;
begin
  select * into e from public.emails where id = p_email;
  if not found then return 0; end if;
  update public.emails set supply_conf_read_at = now() where id = p_email;
  if p_kind not in ('confirmation', 'shipped', 'delivered') or p_requests is null then return 0; end if;
  v_priv := e.mailbox_id is not null and not exists (select 1 from public.email_threads t where t.id = e.thread_id and t.shared_at is not null);
  for r in select * from public.supply_requests where id = any (p_requests) and organization_id = e.organization_id and status in ('requested', 'ordered')
                and e.received_at >= requested_at - interval '1 day' loop
    if p_kind = 'confirmation' and r.status = 'requested' then
      update public.supply_requests set status = 'ordered', ordered_from = left(nullif(trim(p_seller), ''), 120), order_number = left(nullif(trim(p_order), ''), 80),
             ordered_at = e.received_at, order_total = p_total, expected_at = p_expected, tracking = coalesce(nullif(trim(p_tracking), ''), tracking),
             confirm_email_id = e.id, confirm_private = v_priv,
             notify_pending = not r.is_old and r.requested_by_email is not null and e.received_at > now() - interval '3 days'
       where id = r.id;
      update public.tasks set done_at = now(), done_note = 'Ordered' || coalesce(' from ' || nullif(trim(p_seller), ''), '')
       where id = r.task_id and done_at is null;
      n := n + 1;
    elsif p_kind = 'shipped' then
      update public.supply_requests set status = 'ordered', expected_at = coalesce(p_expected, expected_at), tracking = coalesce(nullif(trim(p_tracking), ''), tracking),
             ordered_from = coalesce(ordered_from, left(nullif(trim(p_seller), ''), 120)), order_number = coalesce(order_number, left(nullif(trim(p_order), ''), 80)),
             ordered_at = coalesce(ordered_at, e.received_at), confirm_email_id = coalesce(confirm_email_id, e.id), confirm_private = confirm_private or v_priv
       where id = r.id;
      update public.tasks set done_at = now(), done_note = 'Ordered' where id = r.task_id and done_at is null;
      n := n + 1;
    elsif p_kind = 'delivered' then
      update public.supply_requests set status = 'arrived', arrived_at = e.received_at,
             ordered_from = coalesce(ordered_from, left(nullif(trim(p_seller), ''), 120)), order_number = coalesce(order_number, left(nullif(trim(p_order), ''), 80)),
             confirm_private = confirm_private or v_priv
       where id = r.id;
      update public.tasks set done_at = now(), done_note = 'Arrived' where id = r.task_id and done_at is null;
      n := n + 1;
    end if;
  end loop;
  return n;
end;
$$;

revoke execute on function public.supply_from_confirmation(uuid, text, uuid[], text, text, date, numeric, text) from public, anon, authenticated;
grant execute on function public.supply_from_confirmation(uuid, text, uuid[], text, text, date, numeric, text) to service_role;

update public.supply_requests r set status = 'ordered', arrived_at = null, ordered_from = 'Amazon',
       order_number = '113-5153837-1709816, 113-8992474-9629024', ordered_at = e.received_at, confirm_email_id = e.id,
       confirm_private = false, notify_pending = false
  from public.emails e
 where r.id = 'bc45668c-b4f6-4798-b8e8-17de9d8dc417' and r.status = 'arrived' and e.id = 'c320a678-73c8-458f-a86e-c3b1c1f4001d';
update public.tasks set done_note = 'Ordered from Amazon (Oct 25 order, with the Oct 5 request)'
 where id = (select task_id from public.supply_requests where id = 'bc45668c-b4f6-4798-b8e8-17de9d8dc417') and done_note = 'Arrived';
