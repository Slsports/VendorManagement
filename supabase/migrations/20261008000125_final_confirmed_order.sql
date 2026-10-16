-- 125: the final confirmed order (Dana, Oct 16): "I should be able to change quantities. I should be able to delete it.
-- I should be able to check mark that it's ok. And then it should create the final confirmed order back to the vendor".
--
-- order_checks.row_edits: per comparison row (keyed by its text), the buyer's final quantity, removed, or OK.
-- order_check_edit_row: saves one row's edit (an empty edit clears it).
-- order_check_save_final: the final order as sent becomes the order's lines (a new order when there is none), so the
--   invoice is checked against what was agreed.

alter table public.order_checks add column if not exists row_edits jsonb not null default '{}'::jsonb;
comment on column public.order_checks.row_edits is 'Buyer edits per comparison row, keyed by the row''s "what": {qty, removed, ok}.';

create or replace function public.order_check_edit_row(p_check uuid, p_what text, p_edit jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  c public.order_checks%rowtype;
begin
  if not public.user_can_edit() then raise exception 'Only admins, managers and buyers handle order paperwork' using errcode = '42501'; end if;
  select * into c from public.order_checks where id = p_check for update;
  if c.id is null or not public.user_in_org(c.organization_id) then raise exception 'Check not found' using errcode = '23503'; end if;
  if c.status <> 'to_review' then raise exception 'This check is closed; reopen it to change rows' using errcode = '22023'; end if;
  update public.order_checks
     set row_edits = case when p_edit is null or p_edit = '{}'::jsonb then row_edits - p_what else row_edits || jsonb_build_object(p_what, p_edit) end
   where id = p_check
  returning row_edits into c.row_edits;
  return c.row_edits;
end;
$$;
revoke execute on function public.order_check_edit_row(uuid, text, jsonb) from public, anon;
grant execute on function public.order_check_edit_row(uuid, text, jsonb) to authenticated, service_role;

create or replace function public.order_check_save_final(p_check uuid, p_lines jsonb)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  c public.order_checks%rowtype;
  oid_ uuid;
  l jsonb;
  n integer := 0;
  total numeric := 0;
begin
  if not public.user_can_edit() then raise exception 'Only admins, managers and buyers handle order paperwork' using errcode = '42501'; end if;
  select * into c from public.order_checks where id = p_check for update;
  if c.id is null or not public.user_in_org(c.organization_id) then raise exception 'Check not found' using errcode = '23503'; end if;
  if c.kind <> 'confirmation' then raise exception 'Only a confirmation makes the final order' using errcode = '22023'; end if;
  if jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then raise exception 'The final order has no items' using errcode = '22023'; end if;
  oid_ := c.order_id;
  if oid_ is null then
    insert into public.orders (organization_id, vendor_id, status, source, order_date, po_number, description, notes, sales_report_id)
    values (c.organization_id, c.vendor_id, 'awaiting_confirmation', 'confirmation', coalesce(c.doc_date, c.created_at::date),
            case when public.is_real_po(c.po_number) then c.po_number end,
            left('Final order from confirmation ' || coalesce(c.doc_number, ''), 200), 'The final order sent back to the vendor from their confirmation.',
            case when c.report_id is not null then c.report_id end)
    returning id into oid_;
  else
    delete from public.order_lines where order_id = oid_;
  end if;
  for l in select * from jsonb_array_elements(p_lines) loop
    continue when coalesce((l->>'qty')::numeric, 0) <= 0;
    insert into public.order_lines (organization_id, order_id, sort_order, vendor_item_id, description, quantity, unit_cost)
    values (c.organization_id, oid_, n, nullif(l->>'item', ''), nullif(l->>'name', ''), (l->>'qty')::numeric, coalesce((l->>'cost')::numeric, 0));
    total := total + (l->>'qty')::numeric * coalesce((l->>'cost')::numeric, 0);
    n := n + 1;
  end loop;
  update public.orders set est_cost = case when total > 0 then total else est_cost end where id = oid_;
  update public.order_checks set order_id = oid_ where id = p_check;
  update public.vendor_links set order_id = oid_ where id = c.document_id and order_id is null;
  return oid_;
end;
$$;
revoke execute on function public.order_check_save_final(uuid, jsonb) from public, anon;
grant execute on function public.order_check_save_final(uuid, jsonb) to authenticated, service_role;
