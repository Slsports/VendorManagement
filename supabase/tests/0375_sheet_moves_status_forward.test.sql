-- 0375: a reload moves a VMS-set status forward, never back; other VMS edits stay.
do $$
declare v_org uuid := '00000000-0000-0000-0000-000000000001'; v uuid; o uuid; r record;
begin
  insert into public.vendors (organization_id, name) values (v_org, 'OKU 0375') returning id into v;
  insert into public.orders (organization_id, vendor_id, status, po_number, source, est_cost, free_shipping) values (v_org, v, 'open', 'P0375', 'placed_order_summary', 100, false) returning id into o;
  update public.orders set status = 'received', est_cost = 120 where id = o; -- VMS changes (marked edited)
  perform set_config('vms.import', 'on', true);
  update public.orders set status = 'entered', est_cost = 100 where id = o;  -- the sheet: further along, and its old cost
  select * into r from public.orders where id = o;
  if r.status <> 'entered' or r.est_cost <> 120 then raise exception 'forward/kept: % %', r.status, r.est_cost; end if;
  update public.orders set status = 'open' where id = o;                     -- the sheet going back
  if (select status from public.orders where id = o) <> 'entered' then raise exception 'went back'; end if;
  perform set_config('vms.import', '', true);
  raise exception 'ok-rollback';
exception when others then
  if sqlerrm <> 'ok-rollback' then raise; end if;
end $$;
