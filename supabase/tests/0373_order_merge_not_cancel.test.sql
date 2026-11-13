-- 0373: merging a true duplicate keeps one order with both records' notes, links and filled blanks; the copy is gone
-- (not Cancelled) and remembered for sheet reloads.
do $$
declare v_org uuid := '00000000-0000-0000-0000-000000000001'; v uuid; k uuid; d uuid; th uuid; e uuid; o record; n int;
begin
  insert into public.vendors (organization_id, name) values (v_org, 'TARPS 0367') returning id into v;
  insert into public.orders (organization_id, vendor_id, status, po_number, source, source_key, order_date, est_cost, notes, shipment_notes, free_shipping)
    values (v_org, v, 'entered', 'TARP-KEEP', 'placed_order_summary', 'pos:keep0367', '2026-02-05', 628.58, 'Kept order note.', null, false) returning id into k;
  insert into public.orders (organization_id, vendor_id, status, po_number, source, source_key, order_date, est_cost, notes, shipment_notes, credit_notes, store_codes, free_shipping)
    values (v_org, v, 'paid', 'TARP-COPY', 'order_guide', 'og:copy0367', '2026-02-04', 628.58, 'Copy note.', 'We paid 37.8% freight.', 'Credit for 1 tarp.', '{SLS}', false) returning id into d;
  update public.orders set paid_date = '2026-03-13' where id = d;
  insert into public.email_threads (organization_id, gmail_thread_id, subject, last_message_at, vendor_id) values (v_org, 't0367', 'Tarps', now(), v) returning id into th;
  insert into public.emails (organization_id, thread_id, gmail_id, direction, from_email, to_emails, subject, received_at, body_text, vendor_id, order_id)
    values (v_org, th, 'm0367', 'in', 'a@tarps0367.example', '{orders@shaverlakesports.com}', 'Tarps', now(), 'x', v, d) returning id into e;
  insert into public.tasks (organization_id, title, order_id, vendor_id, assigned_to) values (v_org, 'Check tarps 0367', d, v, '11111111-1111-1111-1111-111111111111');

  perform public.order_duplicate_merge(k, d, 'Entered twice on the sheet.');

  if exists (select 1 from public.orders where id = d) then raise exception 'the copy is still listed'; end if;
  select * into o from public.orders where id = k;
  if o.status <> 'paid' or o.paid_date <> '2026-03-13' then raise exception 'status/paid date not carried: % %', o.status, o.paid_date; end if;
  if o.po_number <> 'TARP-KEEP' or o.source_key <> 'pos:keep0367' then raise exception 'kept values overwritten'; end if;
  if o.store_codes <> '{SLS}' then raise exception 'blank stores not filled: %', o.store_codes; end if;
  if o.notes not like 'Kept order note.%From the merged copy (PO TARP-COPY): Copy note.%Merged %also entered as PO TARP-COPY%Entered twice on the sheet.' then raise exception 'notes: %', o.notes; end if;
  if o.shipment_notes <> 'From the merged copy (PO TARP-COPY): We paid 37.8% freight.' or o.credit_notes not like '%Credit for 1 tarp.' then raise exception 'other notes: % / %', o.shipment_notes, o.credit_notes; end if;
  if (select order_id from public.emails where id = e) <> k then raise exception 'email not moved'; end if;
  if not exists (select 1 from public.tasks where title = 'Check tarps 0367' and order_id = k) then raise exception 'task not moved'; end if;
  select count(*) into n from public.order_merges where kept_order_id = k and merged_order_id = d and source_key = 'og:copy0367' and snapshot ->> 'po_number' = 'TARP-COPY';
  if n <> 1 then raise exception 'merge not remembered'; end if;
  raise exception 'ok-rollback';
exception when others then
  if sqlerrm <> 'ok-rollback' then raise; end if;
end $$;
