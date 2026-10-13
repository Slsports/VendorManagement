-- 0102 — Confirmations without an order, the sales report used, and confirmations with no PO (Dana, Oct 13).
-- • A confirmation is checked against an actual order first: our PO → the vendor's own order number → the email
--   conversation → Claude's comparison with the vendor's open orders (never "only one open order" alone).
-- • When there is no order, or the order has no item list or order document, Claude compares the confirmation with the
--   sales report we ordered from: the one ticked "Used to place the order" (on the order, or in the Sales reports folder),
--   else the report closest before the confirmation's date (marked "Not ticked – please confirm"). It reads the report's
--   Order column, or Need when Order is blank. No order and no report → "Which order is this for?" in the Review queue.
-- • A confirmation with no PO of ours: whoever placed the order (Dana or Jarrett) gets "Create PO: <vendor>, <their
--   number>" unless the order already has one; once the PO is on the order, an email asking the vendor to put it on
--   their order waits in Mail › Drafts.

-- the sales report used to place an order
alter table public.vendor_links add column if not exists report_used_at timestamptz;
alter table public.vendor_links add column if not exists report_used_by uuid references public.profiles(id) on delete set null;
comment on column public.vendor_links.report_used_at is 'A sales report ticked "Used to place the order" (Dana, Oct 5/13).';
alter table public.orders add column if not exists sales_report_id uuid references public.vendor_links(id) on delete set null;
comment on column public.orders.sales_report_id is 'The sales report used to place this order ("Report used").';

alter table public.order_checks add column if not exists match_how text check (match_how in ('po', 'vendor_number', 'conversation', 'total', 'claude', 'picked'));
alter table public.order_checks add column if not exists report_id uuid references public.vendor_links(id) on delete set null;
alter table public.order_checks add column if not exists report_ticked boolean;
alter table public.order_checks add column if not exists po_task_id uuid references public.tasks(id) on delete set null;
alter table public.order_checks add column if not exists po_draft_id uuid references public.email_drafts(id) on delete set null;

-- A real PO number (not blank, "N/A", "none" …).
create or replace function public.is_real_po(p_po text) returns boolean language sql immutable as $$
  select coalesce(length(regexp_replace(p_po, '[^A-Za-z0-9]', '', 'g')) >= 3 and p_po !~* '^\s*(n/?a|none|tbd|pending|na|no po)\s*$', false)
$$;
grant execute on function public.is_real_po(text) to authenticated, service_role;

-- The sales report to compare with: the order's "Report used", else a ticked one, else the closest before the date.
create or replace function public.sales_report_for(p_vendor uuid, p_order uuid, p_date date)
returns table (link_id uuid, ticked boolean)
language sql stable security definer set search_path = public as $$
  with r as (
    select l.id, l.report_used_at is not null as ticked, coalesce(l.doc_date, l.received_at, l.created_at::date) as d
      from public.vendor_links l
     where l.vendor_id = p_vendor and l.kind = 'sales_report' and l.storage_path is not null
  )
  select * from (
    select l.id, true from public.orders o join public.vendor_links l on l.id = o.sales_report_id where o.id = p_order and l.storage_path is not null
    union all
    (select id, true from r where ticked and d <= coalesce(p_date, current_date) + 7 and d >= coalesce(p_date, current_date) - 240 order by d desc limit 1)
    union all
    (select id, false from r where d <= coalesce(p_date, current_date) + 7 and d >= coalesce(p_date, current_date) - 120 order by d desc limit 1)
  ) x limit 1
$$;
revoke execute on function public.sales_report_for(uuid, uuid, date) from public, anon, authenticated;
grant execute on function public.sales_report_for(uuid, uuid, date) to service_role;

-- Finding the order without Claude: our PO, the vendor's own number on another document, the conversation, the total.
create or replace function public.order_check_match(p_check uuid, p_reading jsonb)
returns table (order_id uuid, how text)
language plpgsql stable security definer set search_path = public as $$
declare
  c     public.order_checks%rowtype;
  v_po  text := upper(regexp_replace(coalesce(p_reading->>'po_number', ''), '[^A-Za-z0-9]', '', 'g'));
  v_num text := upper(regexp_replace(coalesce(p_reading->>'doc_number', ''), '[^A-Za-z0-9]', '', 'g'));
  v_tot numeric;
  v_ids uuid[];
begin
  select * into c from public.order_checks where id = p_check;
  if c.id is null then return; end if;
  begin v_tot := nullif(p_reading->>'total', '')::numeric; exception when others then v_tot := null; end;
  -- 1. our PO
  if length(v_po) >= 3 and public.is_real_po(p_reading->>'po_number') then
    select array_agg(o.id order by (o.vendor_id is not distinct from c.vendor_id) desc, o.order_date desc nulls last) into v_ids
      from public.orders o where o.organization_id = c.organization_id and upper(regexp_replace(coalesce(o.po_number, ''), '[^A-Za-z0-9]', '', 'g')) = v_po;
    if cardinality(v_ids) > 1 then
      select array_agg(o.id) into v_ids from public.orders o where o.id = any(v_ids) and o.vendor_id is not distinct from c.vendor_id
         and (c.kind = 'invoice' or o.status not in ('received', 'entered', 'ready_to_pay', 'paid', 'cancelled'));
      -- a PO split over several sheet rows: the one closest in amount
      if cardinality(v_ids) > 1 and v_tot is not null then
        select array_agg(id) into v_ids from (select o.id from public.orders o where o.id = any(v_ids) order by abs(coalesce(o.est_cost, o.final_cost, 0) - v_tot) limit 1) x;
      end if;
    end if;
    if cardinality(v_ids) = 1 then order_id := v_ids[1]; how := 'po'; return next; return; end if;
  end if;
  -- 2. the vendor's own number on another of their documents already tied to an order
  if length(v_num) >= 3 then
    select array_agg(distinct x.order_id) into v_ids from public.order_checks x
     where x.organization_id = c.organization_id and x.id <> c.id and x.vendor_id is not distinct from c.vendor_id and x.order_id is not null
       and upper(regexp_replace(coalesce(x.doc_number, ''), '[^A-Za-z0-9]', '', 'g')) = v_num;
    if cardinality(v_ids) = 1 then order_id := v_ids[1]; how := 'vendor_number'; return next; return; end if;
  end if;
  -- 3. the conversation it came in is already filed to one order
  if c.email_id is not null then
    select array_agg(distinct e.order_id) into v_ids from public.emails e
     where e.thread_id = (select thread_id from public.emails where id = c.email_id) and e.order_id is not null
       and exists (select 1 from public.orders o where o.id = e.order_id and o.vendor_id is not distinct from c.vendor_id);
    if cardinality(v_ids) = 1 then order_id := v_ids[1]; how := 'conversation'; return next; return; end if;
  end if;
  -- 4. exactly one of the vendor's open orders within 3% of the total
  if c.vendor_id is not null and v_tot is not null and v_tot > 0 then
    select array_agg(o.id) into v_ids from public.orders o
     where o.organization_id = c.organization_id and o.vendor_id = c.vendor_id and o.status not in ('cancelled', 'paid')
       and (c.kind = 'invoice' or o.status not in ('received', 'entered', 'ready_to_pay'))
       and abs(coalesce(o.est_cost, o.final_cost, -1e9) - v_tot) <= greatest(5, v_tot * 0.03);
    if cardinality(v_ids) = 1 then order_id := v_ids[1]; how := 'total'; return next; return; end if;
  end if;
end;
$$;
revoke execute on function public.order_check_match(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.order_check_match(uuid, jsonb) to service_role;

-- The PO follow-up for a confirmation without our PO: a task to make the PO, or (PO known) the email to the vendor.
create or replace function public.order_check_po_followup(p_check uuid)
returns text language plpgsql security definer set search_path = public as $$
declare
  c       public.order_checks%rowtype;
  o       public.orders%rowtype;
  v_name  text;
  v_who   uuid;
  v_due   date;
  v_task  uuid;
  v_to    text;
  v_first text;
  v_draft uuid;
  v_num   text;
begin
  select * into c from public.order_checks where id = p_check for update;
  if c.id is null or c.kind <> 'confirmation' or c.reading is null or c.status in ('not_paperwork', 'dismissed') then return null; end if;
  if public.is_real_po(c.reading->>'po_number') then return null; end if;
  if exists (select 1 from public.vendors v where v.id = c.vendor_id and v.web_orders) then return null; end if;
  if c.order_id is not null then select * into o from public.orders where id = c.order_id; end if;
  select name into v_name from public.vendors where id = c.vendor_id;
  v_num := coalesce(nullif(trim(c.doc_number), ''), nullif(trim(c.reading->>'doc_number'), ''));
  v_who := coalesce(case when o.id is not null then public.order_reviewer(o.id) end,
                    (select assigned_buyer_id from public.vendors where id = c.vendor_id),
                    c.assigned_to, public.org_admin(c.organization_id));

  if o.id is null or not public.is_real_po(o.po_number) then
    -- no PO yet: the person who placed the order makes one
    if c.po_task_id is null then
      v_due := public.next_business_day(now());
      insert into public.tasks (organization_id, title, notes, due_date, remind_at, assigned_to, vendor_id, order_id, thread_id, auto_key)
      values (c.organization_id,
              left('Create PO: ' || coalesce(v_name, 'vendor') || ', ' || coalesce(v_num, 'their confirmation'), 200),
              'The vendor''s confirmation' || coalesce(' ' || v_num, '') || ' has no PO of ours. Make the PO if there isn''t one and type it on the order'
                || case when o.id is null then ' (pick or add the order on the confirmation check first)' else '' end
                || '. VMS then puts an email in Mail › Drafts asking them to add our PO to their order.',
              v_due, (v_due + time '09:00') at time zone 'America/Los_Angeles', v_who, c.vendor_id, o.id,
              (select thread_id from public.emails where id = c.email_id), 'create_po:' || c.id)
      on conflict (organization_id, auto_key) where auto_key is not null do nothing
      returning id into v_task;
      update public.order_checks set po_task_id = coalesce(v_task, po_task_id) where id = c.id;
      return 'task';
    end if;
    return 'waiting';
  end if;

  -- the order has our PO: the email asking them to put it on their order (once)
  if c.po_draft_id is not null or exists (select 1 from public.order_checks x where x.id = c.id and x.po_draft_id is not null) then return 'drafted'; end if;
  select from_email into v_to from public.emails where id = c.email_id;
  v_to := coalesce(v_to, (select email from public.vendors where id = c.vendor_id));
  if v_to is not null then
    select split_part(nullif(trim(e.contact_name), ''), ' ', 1) into v_first from public.vendor_emails e where e.vendor_id = c.vendor_id and lower(e.email) = lower(v_to) limit 1;
    insert into public.email_drafts (organization_id, owner_id, created_by, to_emails, subject, body, vendor_id, thread_id, note)
    values (c.organization_id, v_who, null, array[lower(v_to)],
            'Our PO ' || o.po_number || coalesce(' for your order ' || v_num, ''),
            'Hi ' || coalesce(v_first, 'there') || E',\n\nThank you for the confirmation' || coalesce(' (' || v_num || ')', '') || '. Please update the order with our PO number '
              || o.po_number || E' so it shows on the packing list and the invoice.\n\nThank you!',
            c.vendor_id, (select thread_id from public.emails where id = c.email_id),
            'Their confirmation had no PO of ours: asks them to add PO ' || o.po_number)
    returning id into v_draft;
  end if;
  update public.order_checks set po_draft_id = v_draft where id = c.id;
  update public.tasks set done_at = now(), done_note = 'PO ' || o.po_number || ' is on the order' || case when v_draft is not null then '; the email asking them to add it is in Mail › Drafts' else '' end
   where id = c.po_task_id and done_at is null;
  return case when v_draft is null then 'no_address' else 'drafted' end;
end;
$$;
revoke execute on function public.order_check_po_followup(uuid) from public, anon, authenticated;
grant execute on function public.order_check_po_followup(uuid) to service_role;

-- A PO typed on an order (or an order picked for the check) finishes the follow-up.
create or replace function public.orders_po_followup() returns trigger
language plpgsql security definer set search_path = public as $$
declare x uuid;
begin
  if public.is_real_po(new.po_number) and not public.is_real_po(old.po_number) then
    for x in select id from public.order_checks where order_id = new.id and kind = 'confirmation' and po_draft_id is null and po_task_id is not null loop
      perform public.order_check_po_followup(x);
    end loop;
  end if;
  return new;
end;
$$;
drop trigger if exists orders_po_followup on public.orders;
create trigger orders_po_followup after update of po_number on public.orders for each row execute function public.orders_po_followup();

-- Reading a document (order-check): its type and numbers, then the order (found by order_check_match or Claude and
-- passed in), else the sales report, else "Which order is this for?". Web-order vendors' confirmations need no review.
drop function if exists public.order_check_apply_read(uuid, jsonb);
create or replace function public.order_check_apply_read(p_check uuid, p_reading jsonb, p_order uuid default null, p_how text default null)
returns text
language plpgsql security definer set search_path = public as $$
declare
  c       public.order_checks%rowtype;
  v_type  text := p_reading->>'doc_type';
  v_order uuid;
  v_date  date;
  v_web   boolean;
  v_rep   uuid;
  v_tick  boolean;
begin
  select * into c from public.order_checks where id = p_check for update;
  if c.id is null then return 'missing'; end if;
  begin v_date := nullif(p_reading->>'doc_date', '')::date; exception when others then v_date := null; end;
  update public.order_checks set reading = p_reading, working_at = null,
         po_number = nullif(p_reading->>'po_number', ''), doc_number = nullif(p_reading->>'doc_number', ''), doc_date = v_date,
         doc_total = case when coalesce(p_reading->>'total', '') ~ '^-?[0-9]+(\.[0-9]+)?$' then (p_reading->>'total')::numeric end
   where id = p_check;
  update public.vendor_links set doc_number = coalesce(doc_number, nullif(p_reading->>'doc_number', '')), doc_date = coalesce(doc_date, v_date),
         doc_total = coalesce(doc_total, case when coalesce(p_reading->>'total', '') ~ '^-?[0-9]+(\.[0-9]+)?$' then (p_reading->>'total')::numeric end)
   where id = c.document_id;
  if v_type not in ('confirmation', 'invoice') then
    -- filed from an email by its words and it isn't paperwork after all: out of Confirmations / Invoices into Other
    update public.vendor_links set kind = 'other' where id = c.document_id and source = 'email' and kind in ('confirmation', 'invoice');
    update public.order_checks set status = 'not_paperwork', read_note = left(coalesce(p_reading->>'note', 'Not an order confirmation or invoice'), 300) where id = p_check;
    return 'not_paperwork';
  end if;
  if v_type <> c.kind then
    update public.order_checks set kind = v_type where id = p_check;
    update public.vendor_links set kind = v_type where id = c.document_id;
    c.kind := v_type;
  end if;
  v_order := coalesce(c.order_id, p_order);
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
    -- no order: a confirmation is compared with the sales report we ordered from, when there is one
    if v_type = 'confirmation' and c.vendor_id is not null then
      select link_id, ticked into v_rep, v_tick from public.sales_report_for(c.vendor_id, null, coalesce(v_date, c.created_at::date));
    end if;
    if v_rep is not null then
      update public.order_checks set status = 'comparing', report_id = v_rep, report_ticked = v_tick,
             assigned_to = coalesce(assigned_to, (select assigned_buyer_id from public.vendors where id = c.vendor_id), public.org_admin(c.organization_id)),
             assigned_at = coalesce(assigned_at, now())
       where id = p_check;
      perform public.order_check_po_followup(p_check);
      return 'comparing_report';
    end if;
    update public.order_checks set status = 'needs_order', assigned_to = coalesce(assigned_to, public.org_admin(c.organization_id)), assigned_at = coalesce(assigned_at, now()) where id = p_check;
    perform public.order_check_po_followup(p_check);
    return 'needs_order';
  end if;
  update public.order_checks set order_id = v_order, status = 'comparing', match_how = coalesce(match_how, p_how),
         vendor_id = coalesce(vendor_id, (select vendor_id from public.orders where id = v_order)),
         assigned_to = coalesce(assigned_to, public.order_reviewer(v_order)), assigned_at = coalesce(assigned_at, now())
   where id = p_check;
  update public.vendor_links set order_id = v_order where id = c.document_id and order_id is null;
  if c.email_id is not null then update public.emails set order_id = coalesce(order_id, v_order) where id = c.email_id; end if;
  perform public.order_check_po_followup(p_check);
  return 'comparing';
end;
$$;
revoke execute on function public.order_check_apply_read(uuid, jsonb, uuid, text) from public, anon, authenticated;
grant execute on function public.order_check_apply_read(uuid, jsonb, uuid, text) to service_role;

-- What Claude compared it with (order-check): also which sales report, for the check page.
create or replace function public.order_check_apply_compare(p_check uuid, p_result jsonb)
returns void
language plpgsql security definer set search_path = public as $$
begin
  update public.order_checks set status = 'to_review', working_at = null,
         against = left(p_result->>'against', 300),
         against_ids = coalesce((select array_agg(x::uuid) from jsonb_array_elements_text(coalesce(p_result->'against_ids', '[]')) x), '{}'),
         result = case when jsonb_array_length(coalesce(p_result->'issues', '[]')) = 0 then 'match' else 'issues' end,
         summary = left(p_result->>'summary', 2000),
         rows = coalesce(p_result->'rows', '[]'), issues = coalesce(p_result->'issues', '[]'),
         draft_to = coalesce((select array_agg(x) from jsonb_array_elements_text(coalesce(p_result->'draft_to', '[]')) x), '{}'),
         draft_subject = nullif(p_result->>'draft_subject', ''), draft_body = nullif(p_result->>'draft_body', ''), read_note = null,
         report_id = case when p_result ? 'report_id' then nullif(p_result->>'report_id', '')::uuid else report_id end,
         report_ticked = case when p_result ? 'report_ticked' then (p_result->>'report_ticked')::boolean else report_ticked end
   where id = p_check;
end;
$$;
revoke execute on function public.order_check_apply_compare(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.order_check_apply_compare(uuid, jsonb) to service_role;

-- The buttons: as before, and picking the order runs the PO follow-up; "tick_report" confirms the report used.
create or replace function public.order_check_action(p_check uuid, p_action text, p_order uuid default null, p_profile uuid default null, p_thread uuid default null)
returns void
language plpgsql security definer set search_path = public as $$
declare
  c public.order_checks%rowtype;
  o public.orders%rowtype;
begin
  if not public.user_can_edit() then raise exception 'Only admins, managers and buyers handle order paperwork' using errcode = '42501'; end if;
  select * into c from public.order_checks where id = p_check for update;
  if c.id is null or not public.user_in_org(c.organization_id) then raise exception 'Check not found' using errcode = '23503'; end if;
  if p_action = 'set_order' then
    select * into o from public.orders where id = p_order;
    if o.id is null or o.organization_id <> c.organization_id then raise exception 'Order not found' using errcode = '23503'; end if;
    update public.order_checks set order_id = o.id, vendor_id = coalesce(vendor_id, o.vendor_id), status = 'comparing', working_at = null, match_how = 'picked',
           assigned_to = public.order_reviewer(o.id), assigned_at = now() where id = p_check;
    update public.vendor_links set order_id = o.id where id = c.document_id;
    update public.tasks set order_id = o.id where id = c.po_task_id and order_id is null;
    perform public.order_check_po_followup(p_check);
  elsif p_action = 'tick_report' then
    if c.report_id is null then raise exception 'No sales report on this check' using errcode = '22023'; end if;
    perform public.sales_report_tick(c.report_id, true, c.order_id);
    update public.order_checks set report_ticked = true where id = p_check;
  elsif p_action = 'assign' then
    if p_profile is not null and not exists (select 1 from public.profiles where id = p_profile and organization_id = c.organization_id and is_active) then
      raise exception 'Person not found' using errcode = '23503';
    end if;
    update public.order_checks set assigned_to = p_profile, assigned_at = now() where id = p_check;
  elsif p_action in ('done', 'sent') then
    update public.order_checks set status = 'done', outcome = case when p_action = 'sent' then 'sent' else 'no_email' end, sent_thread_id = p_thread,
           reviewed_by = auth.uid(), reviewed_at = now() where id = p_check;
    if c.kind = 'confirmation' and c.order_id is not null then
      update public.orders set status = 'confirmed' where id = c.order_id and status in ('open', 'awaiting_confirmation');
    end if;
  elsif p_action = 'recheck' then
    update public.order_checks set status = case when order_id is null then 'reading' else 'comparing' end, working_at = null, read_note = null where id = p_check;
  elsif p_action = 'dismiss' then
    update public.order_checks set status = 'dismissed', reviewed_by = auth.uid(), reviewed_at = now() where id = p_check;
  elsif p_action = 'reopen' then
    update public.order_checks set status = case when result is null then 'comparing' else 'to_review' end, outcome = null, reviewed_by = null, reviewed_at = null where id = p_check;
  else
    raise exception 'Unknown action %', p_action;
  end if;
end;
$$;
revoke execute on function public.order_check_action(uuid, text, uuid, uuid, uuid) from public, anon;
grant execute on function public.order_check_action(uuid, text, uuid, uuid, uuid) to authenticated, service_role;

-- Tick (or untick) a sales report "Used to place the order"; on an order it becomes that order's "Report used".
-- One ticked report per vendor per buying season: ticking one unticks the vendor's others from the 4 months around it.
create or replace function public.sales_report_tick(p_link uuid, p_on boolean, p_order uuid default null)
returns void language plpgsql security definer set search_path = public as $$
declare
  l public.vendor_links%rowtype;
  d date;
begin
  if auth.uid() is not null and not public.user_can_edit() then raise exception 'Only admins, managers and buyers can do this' using errcode = '42501'; end if;
  select * into l from public.vendor_links where id = p_link;
  if l.id is null or l.kind <> 'sales_report' or (auth.uid() is not null and not public.user_in_org(l.organization_id)) then raise exception 'Sales report not found' using errcode = '23503'; end if;
  d := coalesce(l.doc_date, l.received_at, l.created_at::date);
  if p_on then
    update public.vendor_links set report_used_at = null, report_used_by = null
     where vendor_id = l.vendor_id and kind = 'sales_report' and id <> l.id and report_used_at is not null
       and coalesce(doc_date, received_at, created_at::date) between d - 120 and d + 120;
    update public.vendor_links set report_used_at = coalesce(report_used_at, now()), report_used_by = coalesce(report_used_by, auth.uid()) where id = l.id;
    if p_order is not null then
      update public.orders set sales_report_id = l.id where id = p_order and organization_id = l.organization_id and vendor_id = l.vendor_id;
    end if;
  else
    update public.vendor_links set report_used_at = null, report_used_by = null where id = l.id;
    update public.orders set sales_report_id = null where sales_report_id = l.id and (p_order is null or id = p_order);
  end if;
end;
$$;
revoke execute on function public.sales_report_tick(uuid, boolean, uuid) from public, anon;
grant execute on function public.sales_report_tick(uuid, boolean, uuid) to authenticated, service_role;

-- A new order came in (sent-orders): confirmations and invoices still without an order try again, by PO, their number,
-- the conversation or the total (no longer "the vendor's only open order").
create or replace function public.order_checks_refind(p_org uuid, p_vendor uuid)
returns integer
language plpgsql security definer set search_path = public as $$
declare c record; v_order uuid; v_how text; n integer := 0;
begin
  for c in select * from public.order_checks where organization_id = p_org and vendor_id = p_vendor and order_id is null
             and reading is not null and (status = 'needs_order' or (status = 'to_review' and report_id is not null)) loop
    select m.order_id, m.how into v_order, v_how from public.order_check_match(c.id, c.reading) m;
    if v_order is not null then
      update public.order_checks set order_id = v_order, match_how = v_how, status = 'comparing', working_at = null,
        assigned_to = public.order_reviewer(v_order), assigned_at = now() where id = c.id;
      update public.vendor_links set order_id = v_order where id = c.document_id and order_id is null;
      perform public.order_check_po_followup(c.id);
      n := n + 1;
    end if;
  end loop;
  return n;
end;
$$;
revoke execute on function public.order_checks_refind(uuid, uuid) from public, anon, authenticated;
grant execute on function public.order_checks_refind(uuid, uuid) to service_role;
