-- 1. A box already entered in Lightspeed by hand is tied to the LS purchase order that is there (Dana, Nov 12: "Ls already
--    has a po for this order. And its not the one you created. How do we complete this order to be sure it syncs with the
--    po already in ls"). snopark_shipment_entered_by_hand takes the LS PO and writes it on the shipment and the VMS order.
-- 2. The Lightspeed connection is watched (the refresh token went invalid on Nov 6 and nothing said so until Nov 12): a
--    task for the admin while the sync keeps failing, closed by VMS when it works again.

create or replace function public.snopark_shipment_entered_by_hand(p_shipment uuid, p_note text default null, p_ls_order text default null, p_ls_ref text default null) returns void
language plpgsql security definer set search_path = public as $$
declare sh public.snopark_shipments%rowtype;
begin
  if not public.user_can_edit() then raise exception 'Only admins, managers and buyers receive books' using errcode = '42501'; end if;
  select * into sh from public.snopark_shipments where id = p_shipment and public.user_in_org(organization_id);
  if sh.id is null then raise exception 'Shipment not found' using errcode = '22023'; end if;
  if sh.status = 'done' then return; end if;
  if sh.status <> 'balanced' then raise exception 'The box has to balance against the State''s sheet first (or Dana accepts it as it is)' using errcode = '22023'; end if;
  perform public.snopark_shipment_done(p_shipment, nullif(trim(p_ls_order), ''),
    'Entered in Lightspeed by hand before VMS received it' || case when nullif(trim(p_ls_order), '') is not null then ' (LS PO ' || trim(p_ls_order) || case when nullif(trim(p_ls_ref), '') is not null then ', reference ' || trim(p_ls_ref) else '' end || ')' else '' end
    || case when coalesce(trim(p_note), '') <> '' then ': ' || trim(p_note) else '.' end);
  if nullif(trim(p_ls_order), '') is not null and sh.order_id is not null then
    update public.orders set ls_order_id = trim(p_ls_order), ls_po_number = coalesce(nullif(trim(p_ls_ref), ''), ls_po_number), ls_shop_id = coalesce(ls_shop_id, '3') where id = sh.order_id;
  end if;
end $$;
drop function if exists public.snopark_shipment_entered_by_hand(uuid, text);
revoke execute on function public.snopark_shipment_entered_by_hand(uuid, text, text, text) from public, anon;
grant execute on function public.snopark_shipment_entered_by_hand(uuid, text, text, text) to authenticated;

-- the Nov 2 order: LS purchase order 89 (reference 145SP-2026, ordered 11/2, 600 permits), made by hand in LS
update public.orders set ls_order_id = '89', ls_po_number = coalesce(ls_po_number, '145SP-2026'), ls_shop_id = coalesce(ls_shop_id, '3')
 where po_number = 'CASNOPARK110226' and ls_order_id is null;

-- ---- the Lightspeed connection watch --------------------------------------------------------------------------------
create or replace function public.ls_connection_watch() returns integer
language plpgsql security definer set search_path = public as $$
declare s record; v_admin uuid; n integer := 0; v_down boolean;
begin
  for s in select * from public.ls_sync loop
    v_admin := public.org_admin(s.organization_id);
    if v_admin is null then continue; end if;
    -- down: the sync has been failing for more than 20 minutes (the token, the connection, anything that keeps coming back)
    v_down := s.last_error is not null and s.updated_at < now() - interval '20 minutes'
              and (s.last_error ~* 'refresh token|not connected|401|403|invalid' or coalesce(s.sales_since, s.updated_at) < now() - interval '2 hours');
    if v_down then
      insert into public.tasks (organization_id, title, notes, due_date, remind_at, assigned_to, created_by, auto_key, area)
      values (s.organization_id, 'Lightspeed connection stopped working: reconnect it',
              'VMS cannot read or write Lightspeed. Lightspeed says: ' || left(s.last_error, 300) || E'\n\nGo to Settings › Lightspeed and click Connect again (keep Full access). Sales, items and purchase orders stop updating until then; VMS catches up on its own once it is back. This task closes itself when the connection works again.',
              current_date, now(), v_admin, v_admin, 'ls_down:' || s.organization_id, 'general')
      on conflict (organization_id, auto_key) where auto_key is not null do nothing;
      if found then n := n + 1; end if;
    elsif s.last_error is null then
      update public.tasks set done_at = now(), closed_how = 'vms', remind_at = null, done_note = 'Lightspeed answered again on ' || to_char(now() at time zone 'America/Los_Angeles', 'Mon FMDD, YYYY HH12:MI am') || '; the sync is running.'
       where organization_id = s.organization_id and auto_key = 'ls_down:' || s.organization_id and done_at is null;
    end if;
  end loop;
  return n;
end $$;
revoke execute on function public.ls_connection_watch() from public, anon, authenticated;
grant execute on function public.ls_connection_watch() to service_role;
do $$ begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule(jobid) from cron.job where jobname = 'ls-connection-watch';
    perform cron.schedule('ls-connection-watch', '*/10 * * * *', $job$select public.ls_connection_watch()$job$);
  end if;
end $$;
