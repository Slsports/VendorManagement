-- 0110 — Orders settled at the show (Dana, Oct 15, WFS): "once we meet with them at the show a lot of things change on our
-- order column … they discontinue things or update items … I choose to not reorder some clothing items … so we pick out
-- other clothes." "I still want quantity flagged, just not new items. I will always look at the confirmation just to
-- double check the new items."
-- • vendors.order_set_at_show: a confirmation's items that are not on our order or sales report are new items picked at
--   the show (order_checks.new_items, shown to double check), not issues; quantity and price differences still are.
-- • order_check_use_as_order: "This is our order" on a confirmation check saves its lines as the order (a new order when
--   there is none), so the invoices are checked against it.

alter table public.vendors add column if not exists order_set_at_show boolean not null default false;
comment on column public.vendors.order_set_at_show is 'The order is settled with the rep at the show: new items on the confirmation are not issues (Dana, Oct 15: WFS).';
update public.vendors set order_set_at_show = true where id = '55d9f1c1-856f-465b-a1da-bf8b3a057642';

alter table public.order_checks add column if not exists new_items jsonb not null default '[]'::jsonb;
comment on column public.order_checks.new_items is 'Items on the confirmation that were not on our order or sales report, picked at the show: [{what, qty, price}].';
alter table public.order_checks drop constraint if exists order_checks_outcome_check;
alter table public.order_checks add constraint order_checks_outcome_check check (outcome in ('sent', 'no_email', 'web_order', 'used_as_order'));

alter table public.orders drop constraint if exists orders_source_check;
alter table public.orders add constraint orders_source_check check (source in ('manual', 'order_guide', 'placed_order_summary', 'email', 'show_scan', 'confirmation'));

create or replace function public.order_check_use_as_order(p_check uuid) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  c public.order_checks%rowtype;
  oid_ uuid;
  l jsonb;
  n integer := 0;
begin
  if not public.user_can_edit() then raise exception 'Only admins, managers and buyers handle order paperwork' using errcode = '42501'; end if;
  select * into c from public.order_checks where id = p_check for update;
  if c.id is null or not public.user_in_org(c.organization_id) then raise exception 'Check not found' using errcode = '23503'; end if;
  if c.kind <> 'confirmation' or c.reading is null or jsonb_array_length(coalesce(c.reading->'lines', '[]'::jsonb)) = 0 then
    raise exception 'This confirmation has no item lines to use' using errcode = '22023';
  end if;
  oid_ := c.order_id;
  if oid_ is null then
    insert into public.orders (organization_id, vendor_id, status, source, order_date, po_number, est_cost, description, notes, sales_report_id)
    values (c.organization_id, c.vendor_id, 'confirmed', 'confirmation', coalesce(c.doc_date, c.created_at::date),
            case when public.is_real_po(c.po_number) then c.po_number end, c.doc_total,
            left('From confirmation ' || coalesce(c.doc_number, ''), 200), 'Made from the vendor''s confirmation (This is our order).',
            case when c.report_id is not null then c.report_id end)
    returning id into oid_;
  else
    delete from public.order_lines where order_id = oid_;
    update public.orders set status = 'confirmed' where id = oid_ and status in ('open', 'awaiting_confirmation');
  end if;
  for l in select * from jsonb_array_elements(c.reading->'lines') loop
    continue when coalesce((l->>'quantity')::numeric, 0) <= 0;
    insert into public.order_lines (organization_id, order_id, sort_order, vendor_item_id, description, quantity, unit_cost)
    values (c.organization_id, oid_, n, nullif(l->>'vendor_item_id', ''), nullif(l->>'description', ''), (l->>'quantity')::numeric, coalesce((l->>'unit_cost')::numeric, 0));
    n := n + 1;
  end loop;
  update public.order_checks set order_id = oid_, status = 'done', outcome = 'used_as_order', reviewed_by = auth.uid(), reviewed_at = now() where id = p_check;
  update public.vendor_links set order_id = oid_ where id = c.document_id and order_id is null;
  update public.tasks set order_id = oid_ where id = c.po_task_id and order_id is null;
  return oid_;
end;
$$;
revoke execute on function public.order_check_use_as_order(uuid) from public, anon;
grant execute on function public.order_check_use_as_order(uuid) to authenticated, service_role;
