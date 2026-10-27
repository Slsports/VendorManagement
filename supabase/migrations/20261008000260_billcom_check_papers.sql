-- 0260 — Emery Jensen invoices checked against Bill.com (Dana, Oct 27, "go"). Dana pays EJD on their portal, then selects
-- the bills in Bill.com, checks they match the amount paid and marks them paid offline. "The actual PDF invoice … has the
-- po in it and the invoice number. When I enter into Bill, I enter both the invoice # and the po." EJD also bills for
-- Stihl: "the only way for vms to know if it is a stihl or ejd invoice is to look at how it is billed at the top of the
-- invoice", and "I do not mix payments in EJD because it screws up our QBO".
--
--   • vendors.billcom_check: its invoices are checked against Bill.com (EJ). vendors.billcom_pay_where: where it is paid
--     ("the EJD portal"); its pay-by tasks say to pay there, then mark it paid offline in Bill.com.
--   • Claude reads each such invoice and credit (the billcom function, every 15 minutes): its number, PO, total and the
--     billing heading at the top (vendor_links.billed_as: "Stihl" or "EJD"). Only blanks are filled.
--   • Matched to its Bill.com bill by invoice number (digits only), else PO + amount: vendor_links.billcom_bill_id
--     (In Bill.com); Paid once Bill.com shows it paid. Both tags show only to people with the Accounting tick.
--   • An invoice not in Bill.com 3 days after it came in: an Accounting task for Dana "Enter … in Bill.com" that opens it;
--     it closes itself once the bill is in Bill.com. Only invoices from the last 120 days (the bills VMS reads from
--     Bill.com go back that far, so an older one can't be told).
--   • A Stihl pay-by task lists the Stihl credits on file, never EJD's, and the other way round.

set local lock_timeout = '5s';

alter table public.vendors add column if not exists billcom_check boolean not null default false;
alter table public.vendors add column if not exists billcom_pay_where text;
comment on column public.vendors.billcom_check is 'Its invoices are checked against Bill.com: In Bill.com / Paid, and a task when one is not entered (Dana, Oct 27, EJ).';
comment on column public.vendors.billcom_pay_where is 'Where it is paid when not in Bill.com ("the EJD portal"); pay-by tasks say to pay there, then mark it paid offline in Bill.com.';

alter table public.vendor_links add column if not exists billed_as text;
alter table public.vendor_links add column if not exists doc_po text;
alter table public.vendor_links add column if not exists billcom_bill_id text;
alter table public.vendor_links add column if not exists billcom_read_at timestamptz;
comment on column public.vendor_links.billed_as is 'How the paper is billed, from the heading at its top ("Stihl" or "EJD" on an Emery Jensen paper).';
comment on column public.vendor_links.billcom_bill_id is 'The Bill.com bill this invoice is (In Bill.com).';

-- Emery Jensen: checked, paid on the EJD portal
update public.vendors set billcom_check = true, billcom_pay_where = 'the EJD portal' where id = 'e43d9b97-3c37-47a0-88cb-7d6cb8475a2e';

-- papers to read: invoices and credits of checked vendors from the last 120 days, not read yet
create or replace function public.billcom_papers_queue(p_org uuid, p_limit integer default 10)
returns table (id uuid, storage_path text, file_name text, mime_type text, label text, kind text, vendor_name text)
language sql stable security definer set search_path = public as $$
  select l.id, l.storage_path, l.file_name, l.mime_type, l.label, l.kind::text, v.name
    from public.vendor_links l join public.vendors v on v.id = l.vendor_id
   where l.organization_id = p_org and v.billcom_check and l.kind in ('invoice', 'credit') and l.storage_path is not null
     and l.billcom_read_at is null and coalesce(l.received_at, l.created_at::date) >= current_date - 120
   order by coalesce(l.received_at, l.created_at::date) desc
   limit p_limit
$$;
revoke execute on function public.billcom_papers_queue(uuid, integer) from public, anon, authenticated;
grant execute on function public.billcom_papers_queue(uuid, integer) to service_role;

-- Claude's reading of one paper; only blanks are filled
create or replace function public.billcom_paper_read(p_link uuid, p_number text, p_po text, p_total numeric, p_billed_as text)
returns void language sql security definer set search_path = public as $$
  update public.vendor_links set billcom_read_at = now(),
         doc_number = coalesce(doc_number, nullif(trim(p_number), '')),
         doc_po = coalesce(doc_po, nullif(trim(p_po), '')),
         doc_total = coalesce(doc_total, p_total),
         billed_as = coalesce(billed_as, nullif(trim(p_billed_as), ''))
   where id = p_link;
$$;
revoke execute on function public.billcom_paper_read(uuid, text, text, numeric, text) from public, anon, authenticated;
grant execute on function public.billcom_paper_read(uuid, text, text, numeric, text) to service_role;

-- match checked vendors' invoices to Bill.com bills; Paid; the "enter it" tasks open and close
create or replace function public.billcom_match_papers(p_org uuid)
returns integer language plpgsql security definer set search_path = public as $$
declare l record; b record; who uuid; vn text; n integer := 0;
begin
  for l in select x.* from public.vendor_links x join public.vendors v on v.id = x.vendor_id
            where x.organization_id = p_org and v.billcom_check and x.kind = 'invoice' and x.billcom_bill_id is null
              and coalesce(x.received_at, x.created_at::date) >= current_date - 120 loop
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
revoke execute on function public.billcom_match_papers(uuid) from public, anon, authenticated;
grant execute on function public.billcom_match_papers(uuid) to service_role;

-- pay-by tasks (as 0196), and: matched papers first; a vendor paid elsewhere says where; Stihl and EJD credits kept apart
create or replace function public.billcom_bill_tasks(p_org uuid)
returns integer language plpgsql security definer set search_path = public as $$
declare b record; who uuid; n integer := 0; title text; note text; pl record; creds text;
begin
  perform public.billcom_match_papers(p_org);
  who := public.org_admin(p_org);
  if who is null then return 0; end if;
  for b in select * from public.billcom_bills where organization_id = p_org and gone_at is null and not archived
             and coalesce(upper(payment_status), '') not in ('PAID', 'SCHEDULED', 'IN_PROCESS') and coalesce(due_amount, amount, 0) > 0
             and due_date is not null and due_date <= current_date + 7 loop
    select x.id, x.vendor_id, x.billed_as, x.label, v.name, v.billcom_pay_where into pl
      from public.vendor_links x join public.vendors v on v.id = x.vendor_id
     where x.organization_id = p_org and x.billcom_bill_id = b.bill_id limit 1;
    creds := null;
    if pl.vendor_id is not null then
      select string_agg(coalesce(c.doc_number, c.label) || coalesce(' ($' || to_char(c.doc_total, 'FM999,999,990.00') || ')', ''), ', ' order by c.received_at) into creds
        from public.vendor_links c
       where c.vendor_id = pl.vendor_id and c.kind = 'credit' and coalesce(c.received_at, c.created_at::date) >= current_date - 120
         and coalesce(c.billed_as, '') = coalesce(pl.billed_as, '');
    end if;
    if pl.billcom_pay_where is not null then
      title := format('Pay %s $%s by %s on %s, then mark it paid offline in Bill.com', coalesce(pl.billed_as, pl.name, b.vendor_name, 'vendor'),
                      to_char(coalesce(b.due_amount, b.amount), 'FM999,999,990.00'), to_char(b.due_date, 'FMMM/FMDD/YY'), pl.billcom_pay_where);
      note := concat_ws(' ', case when b.invoice_number is not null then 'Invoice ' || b.invoice_number || '.' end,
                        case when pl.billed_as is not null then 'Billed as ' || pl.billed_as || '; pay it on its own, never mixed with the other billing.' end,
                        case when creds is not null then coalesce(pl.billed_as, 'Its') || ' credits on file (last 120 days; apply any still open): ' || creds || '.' end,
                        'This task closes itself once Bill.com shows it paid.');
    else
      title := format('Pay %s $%s by %s (Bill.com)', coalesce(b.vendor_name, 'vendor'), to_char(coalesce(b.due_amount, b.amount), 'FM999,999,990.00'), to_char(b.due_date, 'FMMM/FMDD/YY'));
      note := concat_ws(' ', case when b.invoice_number is not null then 'Invoice ' || b.invoice_number || '.' end, 'Pay it in Bill.com; this task closes itself once Bill.com shows it paid.');
    end if;
    insert into public.tasks (organization_id, title, notes, due_date, remind_at, assigned_to, vendor_id, auto_key)
    values (p_org, title, note, b.due_date, (b.due_date - 1)::timestamp + interval '9 hours', who, pl.vendor_id, 'billcom:' || b.bill_id)
    on conflict (organization_id, auto_key) where auto_key is not null do update
      set title = excluded.title, due_date = excluded.due_date, notes = excluded.notes, vendor_id = coalesce(public.tasks.vendor_id, excluded.vendor_id)
      where public.tasks.done_at is null and (public.tasks.title <> excluded.title or public.tasks.due_date is distinct from excluded.due_date or public.tasks.notes is distinct from excluded.notes);
    n := n + 1;
  end loop;
  update public.tasks t set done_at = now(), done_note = 'Paid in Bill.com'
   where t.organization_id = p_org and t.auto_key like 'billcom:%' and t.done_at is null
     and not exists (select 1 from public.billcom_bills bb where bb.organization_id = p_org and bb.bill_id = split_part(t.auto_key, ':', 2)
                       and bb.gone_at is null and not bb.archived and coalesce(upper(bb.payment_status), '') not in ('PAID', 'SCHEDULED', 'IN_PROCESS') and coalesce(bb.due_amount, bb.amount, 0) > 0);
  return n;
end;
$$;
revoke execute on function public.billcom_bill_tasks(uuid) from public, anon, authenticated;
grant execute on function public.billcom_bill_tasks(uuid) to service_role;
