-- 0340 — "Enter it in Bill.com" only for bills that really need entering (Dana, Nov 10: "yes, fix the rule"). Of 12 open
-- tasks, 5 were invoices already paid through WWD (Chains Required and A-One from Dec 2024, three Nationwide invoices that
-- came through Edenred) and one a $0.00 no-charge Hendrix replacement. The rule went by the day VMS filed the invoice, so
-- 2024 invoices filed during the Nov 3 clean-up looked new, and it never looked at WWD.
--   • No task for an invoice that is a WWD invoice (on a WWD record by its number, or it came in an Edenred email), or
--     totals $0.00 or less, or is already marked paid.
--   • The 120-day window counts from the invoice's own date when VMS has read it, not the day it was filed.
--   • Open tasks that fit any of these close themselves as made by mistake (0339: hidden), saying why. Back-check below.
set local lock_timeout = '5s';

/** Why an invoice needs no "enter it in Bill.com" task, in plain words; null when it does need one. */
create or replace function public.billcom_enter_not_needed_why(p_link uuid) returns text
language sql stable security definer set search_path = public as $$
  select case
    when l.id is null then 'the invoice is gone'
    when l.paid_at is not null then 'it is already marked paid' || coalesce(' (' || l.paid_how || ')', '')
    when l.doc_total is not null and l.doc_total <= 0 then 'it totals ' || to_char(l.doc_total, 'FM$999,990.00') || ', nothing to pay'
    when w.seq is not null then 'it is WWD invoice ' || w.seq || ', paid through WWD' || coalesce(' on ' || to_char(w.paid_date, 'FMMM/FMDD/YY'), '') || ', never Bill.com'
    when e.from_email ilike '%edenred%' then 'it came through Edenred, so it is a WWD invoice, never Bill.com'
  end
  from (select p_link as id) k
  left join public.vendor_links l on l.id = k.id
  left join lateral (select x.seq, x.paid_date from public.wwd_invoices x
                      where x.organization_id = l.organization_id and l.doc_number is not null
                        and public.vin_norm(x.vendor_invoice_number) = public.vin_norm(l.doc_number)
                        and (x.vendor_id is null or x.vendor_id = l.vendor_id)
                      order by x.paid_date desc nulls last limit 1) w on true
  left join public.emails e on e.id = l.email_id
$$;
revoke execute on function public.billcom_enter_not_needed_why(uuid) from public, anon;
grant execute on function public.billcom_enter_not_needed_why(uuid) to authenticated, service_role;

create or replace function public.billcom_enter_not_needed(p_link uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.billcom_enter_not_needed_why(p_link) is not null
$$;
revoke execute on function public.billcom_enter_not_needed(uuid) from public, anon;
grant execute on function public.billcom_enter_not_needed(uuid) to authenticated, service_role;

create or replace function public.billcom_match_papers(p_org uuid)
returns integer language plpgsql security definer set search_path = public as $$
declare l record; b record; who uuid; vn text; n integer := 0;
begin
  for l in select x.* from public.vendor_links x join public.vendors v on v.id = x.vendor_id
            where x.organization_id = p_org and v.billcom_check and x.kind = 'invoice' and x.billcom_bill_id is null loop
    select bb.* into b from public.billcom_bills bb
     where bb.organization_id = p_org and bb.gone_at is null
       and ((length(regexp_replace(coalesce(l.doc_number, ''), '\D', '', 'g')) >= 4
             and regexp_replace(coalesce(bb.invoice_number, ''), '\D', '', 'g') = regexp_replace(l.doc_number, '\D', '', 'g'))
         or (l.doc_po is not null and l.doc_total is not null and bb.amount = l.doc_total
             and public.po_norm(coalesce(bb.raw->>'purchaseOrderNumber', '')) = public.po_norm(l.doc_po)))
     order by (regexp_replace(coalesce(bb.invoice_number, ''), '\D', '', 'g') = regexp_replace(coalesce(l.doc_number, ''), '\D', '', 'g')) desc
     limit 1;
    if b.bill_id is not null then
      update public.vendor_links set billcom_bill_id = b.bill_id where id = l.id;
      n := n + 1;
    end if;
  end loop;

  -- Paid once Bill.com shows it paid (never over an earlier paid mark)
  update public.vendor_links x set paid_at = current_date, paid_how = 'Bill.com'
    from public.billcom_bills bb
   where x.organization_id = p_org and x.billcom_bill_id = bb.bill_id and bb.organization_id = p_org
     and x.kind = 'invoice' and x.paid_at is null and upper(coalesce(bb.payment_status, '')) = 'PAID';

  -- in Bill.com now: the "enter it" task closes itself
  update public.tasks t set done_at = now(), done_note = 'It is in Bill.com now'
    from public.vendor_links x
   where t.organization_id = p_org and t.auto_key = 'billcom_enter:' || x.id and t.done_at is null and x.billcom_bill_id is not null;

  -- paid through WWD, nothing to pay, or paid another way: the "enter it" task closes itself, saying why
  update public.tasks t set done_at = now(), closed_how = 'mistake', done_note = 'VMS closed it as made by mistake: ' || public.billcom_enter_not_needed_why(x.id)
    from public.vendor_links x
   where t.organization_id = p_org and t.auto_key = 'billcom_enter:' || x.id and t.done_at is null and public.billcom_enter_not_needed(x.id);

  -- not in Bill.com 3 days after it came in (read, so its number is known): a task for Dana
  who := public.org_admin(p_org);
  if who is not null then
    for l in select x.*, v.name as vname from public.vendor_links x join public.vendors v on v.id = x.vendor_id
              where x.organization_id = p_org and v.billcom_check and x.kind = 'invoice' and x.billcom_bill_id is null
                and x.paid_at is null and x.billcom_read_at is not null
                -- the invoice's own date when read, else when it came in: an old invoice filed late is not new (Dana, Nov 10)
                and coalesce(x.doc_date, x.received_at, x.created_at::date) between current_date - 120 and current_date - 3
                and coalesce(x.received_at, x.created_at::date) <= current_date - 3
                and not public.billcom_enter_not_needed(x.id) loop
      insert into public.tasks (organization_id, title, notes, due_date, remind_at, assigned_to, vendor_id, thread_id, auto_key, area)
      values (p_org,
              format('Enter %s invoice %s%s in Bill.com', coalesce(l.billed_as, l.vname), coalesce(l.doc_number, l.label),
                     coalesce(' $' || to_char(l.doc_total, 'FM999,999,990.00'), '')),
              concat_ws(' ', 'It came in ' || to_char(coalesce(l.received_at, l.created_at::date), 'Mon FMDD, YYYY') || ' and is not in Bill.com yet.',
                        case when l.doc_po is not null then 'PO ' || l.doc_po || '.' end,
                        case when l.billed_as is not null then 'Billed as ' || l.billed_as || '.' end,
                        'Click Go to it to open the invoice. This task closes itself once the bill is in Bill.com.'),
              current_date, now(), who, l.vendor_id, public.document_thread((select y from public.vendor_links y where y.id = l.id)), 'billcom_enter:' || l.id, 'accounting')
      on conflict (organization_id, auto_key) where auto_key is not null do nothing;
    end loop;
  end if;
  return n;
end;
$$;

-- ---- back-check: every open "enter it" task ------------------------------------------------------------------------
do $$ declare o record; begin
  for o in select distinct organization_id from public.vendors where billcom_check loop
    perform public.billcom_match_papers(o.organization_id);
  end loop;
end $$;
