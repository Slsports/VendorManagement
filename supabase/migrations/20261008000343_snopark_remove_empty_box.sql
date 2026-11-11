-- An empty box removed (Dana, Nov 10: "remove the empty box"): a shipment started by mistake, with no sheet and no books,
-- can be removed by an editor; this also removes the one clicked twice on Nov 10.
create or replace function public.snopark_shipment_remove(p_shipment uuid) returns void
language plpgsql security definer set search_path = public as $$
declare sh public.snopark_shipments%rowtype;
begin
  if auth.uid() is not null and not public.user_can_edit() then raise exception 'Only admins, managers and buyers remove a box' using errcode = '42501'; end if;
  select * into sh from public.snopark_shipments where id = p_shipment and (auth.uid() is null or public.user_in_org(organization_id));
  if sh.id is null then return; end if;
  if sh.status = 'done' or sh.sheet_link_id is not null or exists (select 1 from public.snopark_books where shipment_id = sh.id) then
    raise exception 'Only an empty box (no sheet, no books) can be removed' using errcode = '22023';
  end if;
  update public.tasks set done_at = now(), closed_how = 'vms', remind_at = null, done_note = 'The box was removed as started by mistake.' where id = sh.task_id and done_at is null;
  delete from public.snopark_shipments where id = sh.id;
end $$;
revoke execute on function public.snopark_shipment_remove(uuid) from public, anon;
grant execute on function public.snopark_shipment_remove(uuid) to authenticated, service_role;

-- the second 11/6 box started by mistake on Nov 10
do $$ declare v uuid; begin
  for v in select id from public.snopark_shipments where sheet_link_id is null and sheet is null and status = 'open' and received_on = '2026-11-06'
             and not exists (select 1 from public.snopark_books b where b.shipment_id = snopark_shipments.id) loop
    perform public.snopark_shipment_remove(v);
  end loop;
end $$;
