-- Dana, Nov 10: "If you see a vendor I am paying in bill.com you need to mark it as a bill.com paid vendor." Three Hendrix
-- invoices sat unpaid in VMS while Bill.com showed them paid, because VMS only matched invoices to Bill.com for vendors with
-- the check turned on (one vendor, EJD) and only invoices from the last 120 days.
-- 1. Every vendor with a Bill.com payment or bill is checked against Bill.com, now and whenever a new Bill.com payment lands.
-- 2. Matching and "Paid" have no age limit; only the "enter it in Bill.com" task keeps its 120-day window.
-- 3. Two wrong records found the same day: the Bill.com accounting contact was named "BILL · John Burton" (Claude took the
--    payee's name off a Bill.com notice), and Mia Burton, a former employee, had been sorted as a Maryellen Reynolds rep
--    (her "PLANET COTTON" email), which put her on Planet Cotton's contacts. Fixed below.

-- ---- 1. vendors paid through Bill.com are checked against it -----------------------------------------------------
update public.vendors v set billcom_check = true
 where not v.billcom_check and (
   exists (select 1 from public.vendor_payments vp where vp.vendor_id = v.id and vp.billcom_payment_id is not null)
   or exists (select 1 from public.billcom_bills b where b.organization_id = v.organization_id
               and (upper(b.vendor_name) = upper(v.name) or upper(b.vendor_name) in (select upper(a) from unnest(v.aliases) a))));

create or replace function public.vendor_payments_billcom_check() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.billcom_payment_id is not null and new.vendor_id is not null then
    update public.vendors set billcom_check = true where id = new.vendor_id and not billcom_check;
  end if;
  return new;
end $$;
drop trigger if exists vendor_payments_billcom_check on public.vendor_payments;
create trigger vendor_payments_billcom_check after insert or update of vendor_id on public.vendor_payments
  for each row execute function public.vendor_payments_billcom_check();

-- ---- 2. match and mark paid at any age -------------------------------------------------------------------------
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

  -- not in Bill.com 3 days after it came in (read, so its number is known): a task for Dana
  who := public.org_admin(p_org);
  if who is not null then
    for l in select x.*, v.name as vname from public.vendor_links x join public.vendors v on v.id = x.vendor_id
              where x.organization_id = p_org and v.billcom_check and x.kind = 'invoice' and x.billcom_bill_id is null
                and x.paid_at is null and x.billcom_read_at is not null
                and coalesce(x.received_at, x.created_at::date) between current_date - 120 and current_date - 3 loop
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

-- ---- 3. the two wrong records --------------------------------------------------------------------------------
update public.accounting_contacts set company = 'Bill.com', person = ''
 where company = 'BILL' and person = 'John Burton';

do $$ declare s record; v_admin uuid; begin
  for s in select * from public.email_senders where sender_key = 'mburtonjeep@gmail.com' and kind = 'rep_group' loop
    update public.email_senders set kind = 'not_vendor', rep_group_id = null, vendor_id = null, view_rule = 'attention', decided_at = now() where id = s.id;
    update public.review_items set status = 'rejected', resolved_at = now(), resolution_note = 'Other – not a vendor (a former employee; Dana, Nov 10)' where id = s.review_item_id and status = 'pending';
    perform public.mail_classify(s.organization_id, (select array_agg(id) from public.emails where sender_id = s.id));
  end loop;
end $$;

-- ---- back-check: everything already on file -------------------------------------------------------------------
do $$ declare o record; begin
  for o in select distinct organization_id from public.vendors where billcom_check loop
    perform public.billcom_match_papers(o.organization_id);
  end loop;
end $$;
