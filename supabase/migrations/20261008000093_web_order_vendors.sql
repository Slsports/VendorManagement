-- 0114 — Web-order vendors skip the confirmation step (Dana, Oct 13): "Any Kellie's order confirmations should not follow
-- the regular order process. They do not need to be confirmed. We order on their website, we get a confirmation, they ship
-- it and we receive it. If they couldn't fulfill something it is not on the invoice to be paid. There may be a few vendors
-- that will bypass the regular order process. We need a check mark or something for that."
-- vendors.web_orders: their confirmation email confirms the order (no "Confirmation vs. our order" check to review, the
-- LS PO is drafted); their invoice is still checked, but items they could not ship are only noted, never an issue.

alter table public.vendors add column if not exists web_orders boolean not null default false;
comment on column public.vendors.web_orders is 'Web orders, no confirmation needed: the order confirmation email confirms the order; nothing to review (Dana, Oct 13).';
update public.vendors set web_orders = true where name = 'KELLI''S' and not web_orders;

alter table public.order_checks drop constraint if exists order_checks_outcome_check;
alter table public.order_checks add constraint order_checks_outcome_check check (outcome in ('sent', 'no_email', 'web_order'));

-- A web-order vendor's order is confirmed once its confirmation arrives (the LS PO draft starts from there).
create or replace function public.web_order_confirm(p_order uuid)
returns void language sql security definer set search_path = public as $$
  update public.orders o set status = 'confirmed'
   where o.id = p_order and o.status in ('open', 'awaiting_confirmation')
     and exists (select 1 from public.vendors v where v.id = o.vendor_id and v.web_orders)
$$;
revoke execute on function public.web_order_confirm(uuid) from public, anon, authenticated;
grant execute on function public.web_order_confirm(uuid) to service_role;

-- Reading a document: a web-order vendor's confirmation needs no review; it confirms its order (when found) and is done.
create or replace function public.order_check_apply_read(p_check uuid, p_reading jsonb)
returns text
language plpgsql security definer set search_path = public as $$
declare
  c       public.order_checks%rowtype;
  v_type  text := p_reading->>'doc_type';
  v_order uuid;
  v_date  date;
  v_web   boolean;
begin
  select * into c from public.order_checks where id = p_check for update;
  if c.id is null then return 'missing'; end if;
  begin v_date := nullif(p_reading->>'doc_date', '')::date; exception when others then v_date := null; end;
  update public.order_checks set reading = p_reading, working_at = null,
         po_number = nullif(p_reading->>'po_number', ''), doc_number = nullif(p_reading->>'doc_number', ''), doc_date = v_date,
         doc_total = nullif(p_reading->>'total', '')::numeric
   where id = p_check;
  update public.vendor_links set doc_number = coalesce(doc_number, nullif(p_reading->>'doc_number', '')), doc_date = coalesce(doc_date, v_date),
         doc_total = coalesce(doc_total, nullif(p_reading->>'total', '')::numeric)
   where id = c.document_id;
  if v_type not in ('confirmation', 'invoice') then
    update public.order_checks set status = 'not_paperwork', read_note = left(coalesce(p_reading->>'note', 'Not an order confirmation or invoice'), 300) where id = p_check;
    return 'not_paperwork';
  end if;
  if v_type <> c.kind then
    -- Claude saw what it really is: refile it (the trigger leaves a check that is already under way alone)
    update public.order_checks set kind = v_type where id = p_check;
    update public.vendor_links set kind = v_type where id = c.document_id;
  end if;
  v_order := coalesce(c.order_id, public.order_check_find_order(c.organization_id, c.vendor_id, v_type, p_reading->>'po_number', nullif(p_reading->>'total', '')::numeric, v_date));
  select coalesce(v.web_orders, false) into v_web from public.vendors v
   where v.id = coalesce(c.vendor_id, (select vendor_id from public.orders where id = v_order));
  if v_type = 'confirmation' and coalesce(v_web, false) then
    update public.order_checks set status = 'done', outcome = 'web_order', result = 'match', order_id = coalesce(order_id, v_order),
           summary = 'Web order: the confirmation email confirms the order, nothing to review.', reviewed_at = now()
     where id = p_check;
    if v_order is not null then
      update public.vendor_links set order_id = v_order where id = c.document_id and order_id is null;
      if c.email_id is not null then update public.emails set order_id = coalesce(order_id, v_order) where id = c.email_id; end if;
      perform public.web_order_confirm(v_order);
    end if;
    return 'done';
  end if;
  if v_order is null then
    update public.order_checks set status = 'needs_order', assigned_to = coalesce(assigned_to, public.org_admin(c.organization_id)), assigned_at = coalesce(assigned_at, now()) where id = p_check;
    return 'needs_order';
  end if;
  update public.order_checks set order_id = v_order, status = 'comparing',
         vendor_id = coalesce(vendor_id, (select vendor_id from public.orders where id = v_order)),
         assigned_to = coalesce(assigned_to, public.order_reviewer(v_order)), assigned_at = coalesce(assigned_at, now())
   where id = p_check;
  update public.vendor_links set order_id = v_order where id = c.document_id and order_id is null;
  if c.email_id is not null then update public.emails set order_id = coalesce(order_id, v_order) where id = c.email_id; end if;
  return 'comparing';
end;
$$;
revoke execute on function public.order_check_apply_read(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.order_check_apply_read(uuid, jsonb) to service_role;

-- Kelli's confirmation check waiting in the Review queue: nothing to review any more.
update public.order_checks c set status = 'done', outcome = 'web_order', reviewed_at = now(),
       summary = 'Web order: the confirmation email confirms the order, nothing to review.'
  from public.vendors v
 where v.id = c.vendor_id and v.web_orders and c.kind = 'confirmation' and c.status in ('reading', 'needs_order', 'comparing', 'to_review', 'failed');
