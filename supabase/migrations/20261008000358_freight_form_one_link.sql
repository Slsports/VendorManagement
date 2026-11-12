-- 0358 — One link to the shipment details form, printed in the routing letter (Dana, Nov 12: "can we have the vendors
-- specific link to our freight form be inserted in this letter … If someone saves the letter, then sends it to another
-- coworker they may not have the link from the original email" … "go single link").
--   • vms.shaverlakesports.com/ship/new: the same form, starting with our PO number and their company name.
--   • A PO that matches one order: the answers go on that order's shipment request (made now if there was none), the same
--     as from the order email: a freight quote and Trevor's "Get freight quote" task.
--   • No match: a freight quote waiting for its order ("Which order?" on Freight › Freight quotes) and Trevor's task,
--     with what they typed. The vendor is matched by the company name when it is one of ours.
--   • Nothing about our orders is shown to whoever opens the link.
set local lock_timeout = '5s';

/** The form's answers as a freight quote's details (as shipment_request_quote builds them). */
create or replace function public.shipment_answers_details(a jsonb, p_method text) returns jsonb
language sql immutable as $$
  select jsonb_build_object(
    'ship_from', concat_ws(', ', nullif(a->>'company', ''), nullif(a->>'address', ''), concat_ws(' ', nullif(a->>'city', ''), nullif(a->>'state', ''))),
    'ship_from_zip', a->>'zip',
    'pickup_type', concat_ws(', ', case when (a->'services') ? 'residential' then 'residential' else 'business' end, case when (a->'services') ? 'liftgate' then 'lift gate needed' end, case when (a->'services') ? 'limited_access' then 'limited access' end),
    'ready_date', a->>'ready_date', 'pickup_hours', a->>'hours',
    'contact', concat_ws(' · ', nullif(a->>'contact_name', ''), nullif(a->>'contact_email', ''), nullif(a->>'contact_phone', '')),
    'cartons', case when p_method = 'parcel' then coalesce(a->'items', '[]'::jsonb) else '[]'::jsonb end,
    'pallets', case when p_method = 'pallet' then coalesce(a->'items', '[]'::jsonb) else '[]'::jsonb end,
    'total_weight', (select sum(case when coalesce(i->>'weight', '') ~ '^[0-9]+(\.[0-9]+)?$' then (i->>'weight')::numeric * greatest(coalesce((i->>'count')::int, 1), 1) else 0 end)
                       from jsonb_array_elements(coalesce(a->'items', '[]'::jsonb)) i),
    'value', null,
    'hazardous', exists (select 1 from jsonb_array_elements(coalesce(a->'items', '[]'::jsonb)) i where (i->>'hazmat')::boolean),
    'notes', concat_ws(' ', nullif(a->>'notes', ''), case when a ? 'po_typed' then 'They typed PO "' || (a->>'po_typed') || '" and company "' || coalesce(a->>'company_typed', '') || '" on the form link from our routing letter.' end),
    'from_form', true)
$$;
revoke execute on function public.shipment_answers_details(jsonb, text) from public, anon, authenticated;

/** The form opened from the routing letter's link: found by our PO number, else a quote for Trevor to place. */
create or replace function public.shipment_form_submit_open(p_po text, p_company text, p_method text, p_answers jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare o public.orders%rowtype; v_req uuid; v_q uuid; v_org uuid; v_vendor uuid; v_vname text; n integer; a jsonb; v_po text; v_co text; v_task uuid; v_cost numeric;
begin
  v_po := left(trim(coalesce(p_po, '')), 60);
  v_co := left(trim(coalesce(p_company, '')), 120);
  if public.po_norm(v_po) = '' then raise exception 'Please give our PO number.'; end if;
  if v_co = '' then raise exception 'Please give your company name.'; end if;
  if p_method not in ('pallet', 'parcel') then raise exception 'Pick Pallet or Parcel'; end if;
  a := coalesce(p_answers, '{}'::jsonb) || jsonb_build_object('po_typed', v_po, 'company_typed', v_co);

  select count(*) into n from public.orders where public.po_norm(po_number) = public.po_norm(v_po) and status <> 'cancelled';
  if n = 1 then
    select * into o from public.orders where public.po_norm(po_number) = public.po_norm(v_po) and status <> 'cancelled';
    select id into v_req from public.shipment_requests where order_id = o.id;
    if v_req is null then
      insert into public.shipment_requests (organization_id, order_id, vendor_id, kind, status, send_as, note)
      values (o.organization_id, o.id, o.vendor_id, 'details', 'sent', public.freight_assignee(o.organization_id), 'Started from the form link in our routing letter.')
      returning id into v_req;
    end if;
    perform public.shipment_request_answered(v_req, 'form', null, p_method, a);
    return jsonb_build_object('matched', true);
  end if;

  -- no single order with that PO: a quote waiting for its order, for Trevor
  select organization_id into v_org from public.orders where public.po_norm(po_number) = public.po_norm(v_po) order by created_at desc limit 1;
  select v.id, v.name, v.organization_id into v_vendor, v_vname, v_org from public.vendors v
   where v.merged_into_id is null and (v_org is null or v.organization_id = v_org)
     and (upper(v.name) = upper(v_co) or upper(v_co) = any (select upper(x) from unnest(v.aliases) x))
   order by v.is_active desc limit 1;
  v_org := coalesce(v_org, (select id from public.organizations order by created_at limit 1));
  v_cost := case when coalesce(a->>'quote_amount', '') ~ '^[0-9]+(\.[0-9]+)?$' then (a->>'quote_amount')::numeric end;
  insert into public.freight_quotes (organization_id, vendor_id, order_id, status, vendor_carrier, vendor_cost, details, ships_by)
  values (v_org, v_vendor, null, 'needs_order', nullif(a->>'carrier', ''), v_cost, public.shipment_answers_details(a, p_method), p_method)
  returning id into v_q;
  insert into public.tasks (organization_id, title, notes, due_date, remind_at, assigned_to, vendor_id, auto_key)
  values (v_org, public.freight_task_title(coalesce(v_vname, v_co), null, true, p_method),
          format('%s filled in the shipment form from the link in our routing letter, for PO "%s", and VMS has no single order with that PO. Open the freight quote (Freight › Freight quotes › Which order?), pick the order, then get the %s price and approve the cheapest.',
                 v_co, v_po, case when p_method = 'pallet' then 'Priority One' else 'WWEX/UPS' end),
          public.next_business_day(now()), now(), public.freight_assignee(v_org), v_vendor, 'freight_quote:' || v_q)
  on conflict (organization_id, auto_key) where auto_key is not null do nothing
  returning id into v_task;
  update public.freight_quotes set task_id = v_task where id = v_q;
  return jsonb_build_object('matched', false);
end $$;
revoke execute on function public.shipment_form_submit_open(text, text, text, jsonb) from public, anon, authenticated;
grant execute on function public.shipment_form_submit_open(text, text, text, jsonb) to service_role;
