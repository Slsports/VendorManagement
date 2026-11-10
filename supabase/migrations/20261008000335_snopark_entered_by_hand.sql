-- A box of Sno-Park books that was already entered in Lightspeed by hand (Dana, Nov 10: "We do have an order that has
-- already been received … It has already been entered in LS."). The receiving check still runs; when the box balances,
-- the person marks it entered by hand and VMS records it without making a second LS purchase order.
create or replace function public.snopark_shipment_entered_by_hand(p_shipment uuid, p_note text default null) returns void
language plpgsql security definer set search_path = public as $$
declare sh public.snopark_shipments%rowtype;
begin
  if not public.user_can_edit() then raise exception 'Only admins, managers and buyers receive books' using errcode = '42501'; end if;
  select * into sh from public.snopark_shipments where id = p_shipment and public.user_in_org(organization_id);
  if sh.id is null then raise exception 'Shipment not found' using errcode = '22023'; end if;
  if sh.status = 'done' then return; end if;
  if sh.status <> 'balanced' then raise exception 'The box has to balance against the State''s sheet first (or Dana accepts it as it is)' using errcode = '22023'; end if;
  perform public.snopark_shipment_done(p_shipment, null, 'Entered in Lightspeed by hand before VMS received it' || case when coalesce(trim(p_note), '') <> '' then ': ' || trim(p_note) else '.' end);
end $$;
revoke execute on function public.snopark_shipment_entered_by_hand(uuid, text) from public, anon;
grant execute on function public.snopark_shipment_entered_by_hand(uuid, text) to authenticated;
