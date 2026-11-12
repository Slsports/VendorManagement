-- 0350 — Actual paid dates for invoices paid in Bill.com (Dana, Nov 12: "I always need actual paid dates please change
-- them"). VMS gave an invoice the day it saw the Bill.com bill paid, so 308 of 312 showed Nov 11 or Nov 12. Now the date
-- is the day of Bill.com's payment on that bill (its payment list, process date), and the 308 are corrected.
-- (WWD invoices already use WWD's paid date; payment emails use the date the email gives, else the email's own date.)
set local lock_timeout = '5s';

create or replace function public.billcom_match_papers(p_org uuid)
returns integer language plpgsql security definer set search_path = public as $$
declare l record; b record; who uuid; vn text; n integer := 0;
begin
  -- a vendor whose invoice is in Bill.com under another name (Dana, Nov 11: Kelli's Gifts, Dick's Fishing Charters)
  perform public.billcom_vendors_by_number(p_org);
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

  -- Paid once Bill.com shows it paid, on the day Bill.com paid it (Dana, Nov 12: "I always need actual paid dates"):
  -- the last Bill.com payment on that bill; until that payment is read, it waits (never over an earlier paid mark)
  update public.vendor_links x set paid_at = p.paid_on, paid_how = 'Bill.com'
    from public.billcom_bills bb
    join lateral (select max(vp.process_date) as paid_on from public.vendor_payments vp
                   where vp.organization_id = p_org and vp.billcom_bill_id = bb.bill_id and vp.process_date is not null) p on p.paid_on is not null
   where x.organization_id = p_org and x.billcom_bill_id = bb.bill_id and bb.organization_id = p_org
     and x.kind = 'invoice' and x.paid_at is null and upper(coalesce(bb.payment_status, '')) = 'PAID';

  -- in Bill.com now: the "enter it" task closes itself
  update public.tasks t set done_at = now(), done_note = 'It is in Bill.com now'
    from public.vendor_links x
   where t.organization_id = p_org and t.auto_key = 'billcom_enter:' || x.id and t.done_at is null and x.billcom_bill_id is not null;

  -- paid through WWD, nothing to pay, or paid another way: the "enter it" task closes itself, saying why
  -- only the open tasks are checked (Nov 11: checking every invoice on file took over 30 seconds)
  with open_tasks as materialized (
    select t.id, substr(t.auto_key, 15)::uuid as link_id from public.tasks t
     where t.organization_id = p_org and t.auto_key like 'billcom_enter:%' and t.done_at is null),
  why as materialized (select o.id, public.billcom_enter_not_needed_why(o.link_id) as why from open_tasks o)
  update public.tasks t set done_at = now(), closed_how = 'mistake', done_note = 'VMS closed it as made by mistake: ' || w.why
    from why w where t.id = w.id and w.why is not null;

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


-- correct the ones already marked
update public.vendor_links l set paid_at = p.paid_on
  from (select vp.organization_id, vp.billcom_bill_id, max(vp.process_date) as paid_on from public.vendor_payments vp
         where vp.billcom_bill_id is not null and vp.process_date is not null group by 1, 2) p
 where l.kind = 'invoice' and l.paid_how = 'Bill.com' and l.organization_id = p.organization_id
   and l.billcom_bill_id = p.billcom_bill_id and l.paid_at is distinct from p.paid_on;
