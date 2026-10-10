-- 0025 — Orders added by hand (Dana, Oct 8: Tyler ordered hats from a new vendor and paid by card).
-- "Add order" on the vendor page and on a conversation: paid by check is now a choice, and an order
-- can be tied to the email conversation it came from.

alter table public.orders drop constraint if exists orders_paid_via_check;
alter table public.orders add constraint orders_paid_via_check check (paid_via in ('billcom', 'wwd', 'card', 'check', 'other'));

-- Tie every message of a conversation to an order (or untie with null). Editors only.
create or replace function public.link_email_thread_order(p_thread uuid, p_order uuid)
returns void
language plpgsql security definer
set search_path = public
as $$
declare t public.email_threads%rowtype;
begin
  if not public.user_can_edit() then raise exception 'Only admins, managers and buyers link mail to orders'; end if;
  select * into t from public.email_threads where id = p_thread;
  if not found or not public.user_in_org(t.organization_id) then raise exception 'Conversation not found'; end if;
  if p_order is not null and not exists (select 1 from public.orders where id = p_order and organization_id = t.organization_id) then raise exception 'Order not found'; end if;
  update public.emails set order_id = p_order where thread_id = p_thread;
end;
$$;
revoke execute on function public.link_email_thread_order(uuid, uuid) from public, anon;
grant execute on function public.link_email_thread_order(uuid, uuid) to authenticated, service_role;
