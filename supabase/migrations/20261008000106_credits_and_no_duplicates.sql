-- 0106 — Credits, billing-system mail and no duplicates (Dana, Oct 14: "an invoice filed that is an obvious credit";
-- "an email came in today and the invoice wasn't filed"; "Everytime we change something I want all the old stuff checked to
-- make sure it goes in the right place … And no duplicates").
-- • Claude can now say a document is a credit memo: it goes to Credits, not Invoices, and gets no invoice check.
-- • A document already on file (same vendor, kind, number and total, or the same file) is kept once: vendor_links_dedupe
--   keeps the best copy (on an order, checked, paperwork folder, oldest), moves what pointed at the others to it, and
--   removes the others. It runs hourly as a safety net; the mail steps also check before saving.
-- • Back-check: Confirmations / Invoices that Claude read as a credit or not paperwork move to Credits / Other; duplicates go.

-- Keep one copy of each file per vendor. Returns how many copies were removed.
create or replace function public.vendor_links_dedupe(p_vendor uuid default null)
returns integer language plpgsql security definer set search_path = public as $$
declare
  g    record;
  keep uuid;
  dup  uuid;
  n    integer := 0;
begin
  for g in
    with l as (
      select x.*, (select c.status from public.order_checks c where c.document_id = x.id) check_status
        from public.vendor_links x
       where x.storage_path is not null and x.vendor_id is not null and (p_vendor is null or x.vendor_id = p_vendor)
    ), keyed as (
      -- the same file (name and size), or the same paperwork (kind, number and total)
      select l.*, 'f:' || l.vendor_id || ':' || lower(l.file_name) || ':' || coalesce(l.file_size::text, '') as k from l where l.file_name is not null
      union all
      select l.*, 'd:' || l.vendor_id || ':' || l.kind || ':' || upper(regexp_replace(l.doc_number, '[^A-Za-z0-9]', '', 'g')) || ':' || coalesce(l.doc_total::text, '')
        from l where l.kind in ('invoice', 'confirmation', 'credit') and nullif(regexp_replace(coalesce(l.doc_number, ''), '[^A-Za-z0-9]', '', 'g'), '') is not null
    )
    select k, array_agg(id order by (order_id is not null) desc, (check_status in ('to_review', 'done')) desc nulls last,
                                    (kind in ('confirmation', 'invoice', 'credit', 'order', 'ls_po', 'sales_report')) desc, created_at, id) ids
      from keyed group by k having count(*) > 1
  loop
    keep := g.ids[1];
    if not exists (select 1 from public.vendor_links where id = keep) then continue; end if;
    foreach dup in array g.ids[2:] loop
      continue when not exists (select 1 from public.vendor_links where id = dup) or dup = keep;
      update public.email_attachments set vendor_link_id = keep where vendor_link_id = dup;
      update public.delivery_receipts set vendor_link_id = keep where vendor_link_id = dup;
      update public.sales_reports set document_id = keep where document_id = dup;
      update public.orders set sales_report_id = keep where sales_report_id = dup;
      update public.order_checks set report_id = keep where report_id = dup;
      update public.order_checks set against_ids = array_replace(against_ids, dup, keep) where dup = any(against_ids);
      -- a check on the copy moves to the one kept when that one has none
      if not exists (select 1 from public.order_checks where document_id = keep) then
        update public.order_checks set document_id = keep where document_id = dup;
      end if;
      update public.vendor_links k set order_id = coalesce(k.order_id, d.order_id), doc_number = coalesce(k.doc_number, d.doc_number),
             doc_date = coalesce(k.doc_date, d.doc_date), doc_total = coalesce(k.doc_total, d.doc_total), report_used_at = coalesce(k.report_used_at, d.report_used_at)
        from public.vendor_links d where k.id = keep and d.id = dup;
      delete from public.vendor_links where id = dup;
      n := n + 1;
    end loop;
  end loop;
  return n;
end;
$$;
revoke execute on function public.vendor_links_dedupe(uuid) from public, anon, authenticated;
grant execute on function public.vendor_links_dedupe(uuid) to service_role;

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
  if v_type = 'credit' then
    -- a credit memo (Dana, Oct 14: "an invoice filed that is an obvious credit"): into Credits, no invoice check
    update public.vendor_links set kind = 'credit' where id = c.document_id and kind in ('confirmation', 'invoice');
    update public.order_checks set status = 'not_paperwork', read_note = left('A credit memo: filed in Credits. ' || coalesce(p_reading->>'note', ''), 300) where id = p_check;
    return 'credit';
  end if;
  if v_type not in ('confirmation', 'invoice') then
    -- filed from an email by its words and it isn't paperwork after all: out of Confirmations / Invoices into Other
    update public.vendor_links set kind = 'other' where id = c.document_id and source = 'email' and kind in ('confirmation', 'invoice');
    update public.order_checks set status = 'not_paperwork', read_note = left(coalesce(p_reading->>'note', 'Not an order confirmation or invoice'), 300) where id = p_check;
    return 'not_paperwork';
  end if;
  -- the same document already on file (same number and total): this copy goes, the one on file stays (Dana: "no duplicates")
  if nullif(p_reading->>'doc_number', '') is not null and exists (
       select 1 from public.vendor_links x where x.vendor_id = c.vendor_id and x.id <> c.document_id and x.kind = v_type and x.storage_path is not null
          and upper(regexp_replace(x.doc_number, '[^A-Za-z0-9]', '', 'g')) = upper(regexp_replace(p_reading->>'doc_number', '[^A-Za-z0-9]', '', 'g'))
          and x.doc_total is not distinct from (case when coalesce(p_reading->>'total', '') ~ '^-?[0-9]+(\.[0-9]+)?$' then (p_reading->>'total')::numeric end)) then
    update public.vendor_links set kind = v_type where id = c.document_id;
    perform public.vendor_links_dedupe(c.vendor_id);
    return 'duplicate';
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


-- Back-check: what Claude already read as a credit or not paperwork leaves Confirmations / Invoices.
update public.vendor_links l set kind = case when coalesce(c.read_note, '') ~* 'credit' or coalesce(c.reading->>'note', '') ~* 'credit memo' then 'credit' else 'other' end
  from public.order_checks c
 where c.document_id = l.id and c.status = 'not_paperwork' and l.kind in ('confirmation', 'invoice');
update public.order_checks c set read_note = left('A credit memo: filed in Credits. ' || coalesce(c.read_note, ''), 300)
  from public.vendor_links l where l.id = c.document_id and l.kind = 'credit' and c.status in ('not_paperwork', 'dismissed') and coalesce(c.read_note, '') !~ '^A credit memo';
update public.order_checks c set status = 'not_paperwork'
  from public.vendor_links l where l.id = c.document_id and c.status = 'dismissed' and c.read_note ~ '^(A credit memo|Moved out of)' and c.reading->>'doc_type' not in ('confirmation', 'invoice');
-- and the duplicates already filed
select public.vendor_links_dedupe(null);

-- Hourly safety net: any copy that slipped in is merged.
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule(jobid) from cron.job where jobname = 'vendor-files-dedupe';
    perform cron.schedule('vendor-files-dedupe', '23 * * * *', 'select public.vendor_links_dedupe(null)');
  end if;
end $$;
