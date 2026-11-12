-- A Sno-Park order that was never sent can be removed (Dana, Nov 12: "I want to test placing new orders. After I try it
-- can you delete it or can I?"): the draft email, the task, the filled form and the VMS order behind it go with it.
create or replace function public.snopark_order_remove(p_order uuid) returns void
language plpgsql security definer set search_path = public as $$
declare o public.snopark_orders%rowtype;
begin
  if not public.user_can_edit() then raise exception 'Only admins, managers and buyers remove an order' using errcode = '42501'; end if;
  select * into o from public.snopark_orders where id = p_order and public.user_in_org(organization_id);
  if o.id is null then raise exception 'Order not found' using errcode = '22023'; end if;
  if o.status <> 'draft' then raise exception 'Only an order that was not sent yet can be removed' using errcode = '22023'; end if;
  if exists (select 1 from public.snopark_shipments where order_id = o.order_id) then raise exception 'A box was received against this order; it cannot be removed' using errcode = '22023'; end if;
  update public.tasks set done_at = now(), done_by = auth.uid(), closed_how = 'mistake', remind_at = null, draft_id = null, done_note = 'The Sno-Park order was removed before it was sent.' where id = o.task_id and done_at is null;
  delete from public.email_drafts where id = o.draft_id;
  update public.vendor_links set is_current = false, superseded_at = now(), order_id = null, notes = coalesce(notes, '') || ' Removed with the order before it was sent.' where id = o.file_link_id;
  delete from public.snopark_orders where id = o.id;
  delete from public.orders where id = o.order_id and status = 'open' and not exists (select 1 from public.order_checks c where c.order_id = o.order_id);
end $$;
revoke execute on function public.snopark_order_remove(uuid) from public, anon;
grant execute on function public.snopark_order_remove(uuid) to authenticated;
