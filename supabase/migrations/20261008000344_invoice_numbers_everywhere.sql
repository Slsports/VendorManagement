-- 0344 — Invoice numbers read on every invoice, any vendor, any age (Dana, Nov 11: "yes go, check all vendors and fix
-- them"). 739 invoices had no number: Claude only read invoices of Bill.com vendors from the last 120 days, so older ones
-- (Scope 1216, 1235, 1267, 1284, 1288, paid in Bill.com) never matched and showed unpaid.
--   • Claude (Haiku) reads every invoice with no number once: number, PO, total and now the invoice date. Only blanks
--     are filled. A catch-up job runs every 5 minutes while any are left, then does nothing.
--   • A number read matches Bill.com (Paid), and a payment email that named it (paid later).
--   • A vendor whose invoice is in Bill.com under another name, by number and the same amount, is checked against Bill.com
--     from now on when the first word of both names matches (Kelli's = Kelli's Gifts, Dick's Mountain Tackle = Dick's
--     Fishing Charters & Mountain Tackle). Other number matches (Coastal Pet 8920 = Sticker Pack Inc.) are left to Dana.
set local lock_timeout = '5s';

-- papers to read: as before (invoices and credits of Bill.com vendors, last 120 days), plus every invoice with no number
create or replace function public.billcom_papers_queue(p_org uuid, p_limit integer default 10)
returns table (id uuid, storage_path text, file_name text, mime_type text, label text, kind text, vendor_name text)
language sql stable security definer set search_path = public as $$
  select l.id, l.storage_path, l.file_name, l.mime_type, l.label, l.kind::text, v.name
    from public.vendor_links l join public.vendors v on v.id = l.vendor_id
   where l.organization_id = p_org and l.storage_path is not null and l.billcom_read_at is null
     and ((v.billcom_check and l.kind in ('invoice', 'credit') and coalesce(l.received_at, l.created_at::date) >= current_date - 120)
          or (l.kind = 'invoice' and l.doc_number is null))
   order by (v.billcom_check and coalesce(l.received_at, l.created_at::date) >= current_date - 120) desc,
            coalesce(l.received_at, l.created_at::date) desc
   limit p_limit
$$;
revoke execute on function public.billcom_papers_queue(uuid, integer) from public, anon, authenticated;
grant execute on function public.billcom_papers_queue(uuid, integer) to service_role;

-- Claude's reading of one paper; only blanks are filled (now with the invoice date)
drop function if exists public.billcom_paper_read(uuid, text, text, numeric, text);
create or replace function public.billcom_paper_read(p_link uuid, p_number text, p_po text, p_total numeric, p_billed_as text, p_date date default null)
returns void language sql security definer set search_path = public as $$
  update public.vendor_links set billcom_read_at = now(),
         doc_number = coalesce(doc_number, nullif(trim(p_number), '')),
         doc_po = coalesce(doc_po, nullif(trim(p_po), '')),
         doc_total = coalesce(doc_total, p_total),
         doc_date = coalesce(doc_date, case when p_date between date '2015-01-01' and current_date + 60 then p_date end),
         billed_as = coalesce(billed_as, nullif(trim(p_billed_as), ''))
   where id = p_link;
$$;
revoke execute on function public.billcom_paper_read(uuid, text, text, numeric, text, date) from public, anon, authenticated;
grant execute on function public.billcom_paper_read(uuid, text, text, numeric, text, date) to service_role;

/** Bill.com check on for a vendor whose invoice is a Bill.com bill by number and amount, when the names start alike. */
create or replace function public.billcom_vendors_by_number(p_org uuid) returns integer
language plpgsql security definer set search_path = public as $$
declare k integer;
begin
  with hit as (
    select distinct v.id
      from public.vendor_links l join public.vendors v on v.id = l.vendor_id
      join public.billcom_bills bb on bb.organization_id = l.organization_id and bb.gone_at is null
       and length(regexp_replace(coalesce(l.doc_number, ''), '\D', '', 'g')) >= 4
       and regexp_replace(coalesce(bb.invoice_number, ''), '\D', '', 'g') = regexp_replace(l.doc_number, '\D', '', 'g')
       and bb.amount = l.doc_total
     where l.organization_id = p_org and l.kind = 'invoice' and not v.billcom_check
       and split_part(upper(regexp_replace(v.name, '[^A-Za-z0-9 ]', '', 'g')), ' ', 1)
         = split_part(upper(regexp_replace(bb.vendor_name, '[^A-Za-z0-9 ]', '', 'g')), ' ', 1))
  update public.vendors v set billcom_check = true from hit where v.id = hit.id;
  get diagnostics k = row_count;
  return k;
end;
$$;
revoke execute on function public.billcom_vendors_by_number(uuid) from public, anon, authenticated;

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

-- catch-up: every 5 minutes while invoices without a number are left to read (one cheap check when none are)
do $$ begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') and exists (select 1 from pg_extension where extname = 'pg_net') then
    perform cron.unschedule(jobid) from cron.job where jobname = 'invoice-numbers';
    perform cron.schedule('invoice-numbers', '*/5 * * * *',
      $job$select net.http_post(url := 'https://bpdpkytfmpbwpbmpejbf.supabase.co/functions/v1/billcom', headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'mail_cron_secret')), body := '{"action":"read_papers"}'::jsonb, timeout_milliseconds := 150000)
             where exists (select 1 from public.vendor_links where kind = 'invoice' and doc_number is null and storage_path is not null and billcom_read_at is null)$job$);
  end if;
end $$;

-- back-check: vendors in Bill.com under another name, then match everything already read
do $$ declare o record; begin
  for o in select id from public.organizations loop
    perform public.billcom_match_papers(o.id);
  end loop;
end $$;
