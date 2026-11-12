-- 0358: the routing letter's form link — a known PO lands on its order (a request made if none, a quote, Trevor's task);
-- an unknown PO becomes a quote waiting for its order, matched to the vendor by company name.
do $$
declare v_org uuid := '00000000-0000-0000-0000-000000000001'; v uuid; o uuid; r jsonb; q record; v_trevor uuid := '33333333-3333-3333-3333-333333333333';
  ans jsonb := '{"company":"Acme Warehouse","zip":"93612","contact_name":"Sam","contact_email":"sam@acme0358.example","quote_amount":"250","carrier":"XPO","items":[{"count":2,"weight":400}]}';
begin
  update public.profiles set is_active = true, handles_logistics = true where id = v_trevor;
  insert into public.vendors (organization_id, name) values (v_org, 'ACME 0358') returning id into v;
  insert into public.orders (organization_id, vendor_id, status, po_number, source, free_shipping) values (v_org, v, 'open', 'PO-0358-A', 'manual', false) returning id into o;

  r := public.shipment_form_submit_open('po0358a', 'Acme', 'pallet', ans);
  if not (r->>'matched')::boolean then raise exception 'known PO not matched'; end if;
  select * into q from public.shipment_requests where order_id = o;
  if q.id is null or q.status <> 'answered' or q.quote_id is null then raise exception 'request not answered: %', q.status; end if;
  if (select vendor_cost from public.freight_quotes where id = q.quote_id) <> 250 then raise exception 'quote amount wrong'; end if;

  r := public.shipment_form_submit_open('NOPE-0358', 'acme 0358', 'parcel', ans);
  if (r->>'matched')::boolean then raise exception 'unknown PO matched'; end if;
  select * into q from public.freight_quotes where status = 'needs_order' and vendor_id = v and details->>'notes' like '%NOPE-0358%';
  if q.id is null then raise exception 'no waiting quote for the unknown PO'; end if;
  if not exists (select 1 from public.tasks where auto_key = 'freight_quote:' || q.id and done_at is null) then raise exception 'no task for Trevor'; end if;

  begin perform public.shipment_form_submit_open('', 'x', 'pallet', ans); raise exception 'empty PO accepted';
  exception when others then if sqlerrm not like 'Please give our PO number.%' then raise; end if; end;
  raise exception 'ok-rollback';
exception when others then
  if sqlerrm <> 'ok-rollback' then raise; end if;
end $$;
