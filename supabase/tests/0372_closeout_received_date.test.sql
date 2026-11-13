-- 0372: the received-date step of the close-out
do $$
declare v_org uuid := '00000000-0000-0000-0000-000000000001'; v uuid; o uuid; r jsonb;
begin
  insert into public.vendors (organization_id, name) values (v_org, 'Eastman 0372') returning id into v;
  insert into public.orders (organization_id, vendor_id, status, po_number, source, order_date, date_received) values (v_org, v, 'awaiting_confirmation', 'EAST0372', 'placed_order_summary', '2026-02-02', '2026-10-19') returning id into o;
  r := public.orders_closeout(v_org);
  if (select status from public.orders where id = o) <> 'received' then raise exception 'received date not honored: %', r; end if;
  if (select (changed_at at time zone 'America/Los_Angeles')::date from public.order_status_history where order_id = o and to_status = 'received') <> '2026-10-19' then raise exception 'history not dated by the received date'; end if;
  raise exception 'ok-rollback';
exception when others then
  if sqlerrm <> 'ok-rollback' then raise; end if;
end $$;
