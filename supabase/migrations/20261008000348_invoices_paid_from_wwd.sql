-- 0348 — Invoices paid through WWD show Paid (Dana, Nov 12: "Yes make wwd pmt automatically"). 735 invoices WWD's records
-- show paid still showed unpaid in VMS: VMS used WWD's paid dates for orders and the Payments page, never for the invoice
-- papers filed under a vendor.
--   • An invoice is Paid when a WWD invoice for the same vendor with the same invoice number has a paid date: Paid on that
--     date, how "WWD (invoice <WWD number>)". Never over an earlier paid mark.
--   • Whenever a WWD invoice gets its paid date (Payment History, Edenred, Dana's sheets), and whenever an invoice's number
--     is read or its vendor changes. Back-check below.
--   • A reminder for Dana (Nov 12, "Remind me to look at Coastal pet"): Coastal Pet invoice 8920 ($5,900) has the number and
--     amount of a paid Bill.com bill from Sticker Pack Inc., so it may be filed under the wrong vendor.
set local lock_timeout = '5s';

/** Mark invoices paid from WWD's paid dates: one invoice (p_link) or all of an organization's (p_link null). */
create or replace function public.invoices_paid_from_wwd(p_org uuid, p_link uuid default null) returns integer
language plpgsql security definer set search_path = public as $$
declare k integer;
begin
  update public.vendor_links l set paid_at = m.paid_date, paid_how = 'WWD (invoice ' || m.seq || ')'
    from (select distinct on (x.id) x.id, w.paid_date, w.seq
            from public.vendor_links x
            join public.wwd_invoices w on w.organization_id = x.organization_id and w.vendor_id = x.vendor_id and w.kind = 'invoice'
             and w.paid_date is not null and public.vin_norm(w.vendor_invoice_number) = public.vin_norm(x.doc_number)
           where x.organization_id = p_org and x.kind = 'invoice' and x.paid_at is null and x.doc_number is not null
             and (p_link is null or x.id = p_link)
           order by x.id, w.paid_date desc) m
   where l.id = m.id and l.paid_at is null;
  get diagnostics k = row_count;
  return k;
end;
$$;
revoke execute on function public.invoices_paid_from_wwd(uuid, uuid) from public, anon, authenticated;
grant execute on function public.invoices_paid_from_wwd(uuid, uuid) to service_role;

-- a WWD invoice gets its paid date (or its vendor or number): the vendor's invoice paper with that number is Paid
create or replace function public.wwd_invoices_pay_papers() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.paid_date is null or new.vendor_id is null or new.kind <> 'invoice' or public.vin_norm(new.vendor_invoice_number) is null then return null; end if;
  update public.vendor_links l set paid_at = new.paid_date, paid_how = 'WWD (invoice ' || new.seq || ')'
   where l.organization_id = new.organization_id and l.vendor_id = new.vendor_id and l.kind = 'invoice' and l.paid_at is null
     and public.vin_norm(l.doc_number) = public.vin_norm(new.vendor_invoice_number);
  return null;
end;
$$;
revoke execute on function public.wwd_invoices_pay_papers() from public, anon, authenticated;
drop trigger if exists wwd_invoices_pay_papers on public.wwd_invoices;
create trigger wwd_invoices_pay_papers after insert or update of paid_date, vendor_id, vendor_invoice_number, kind on public.wwd_invoices
  for each row execute function public.wwd_invoices_pay_papers();

-- an invoice paper gets its number or vendor: Paid if WWD shows it paid
create or replace function public.vendor_links_paid_from_wwd() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.kind <> 'invoice' or new.paid_at is not null or new.doc_number is null or new.vendor_id is null then return null; end if;
  perform public.invoices_paid_from_wwd(new.organization_id, new.id);
  return null;
end;
$$;
revoke execute on function public.vendor_links_paid_from_wwd() from public, anon, authenticated;
drop trigger if exists vendor_links_paid_from_wwd on public.vendor_links;
create trigger vendor_links_paid_from_wwd after insert or update of kind, doc_number, vendor_id on public.vendor_links
  for each row execute function public.vendor_links_paid_from_wwd();

-- back-check: everything already on file
do $$ declare o record; begin
  for o in select id from public.organizations loop
    perform public.invoices_paid_from_wwd(o.id);
  end loop;
end $$;

-- Dana's reminder: Coastal Pet 8920
do $$ declare v_link uuid := '0caf8fe7-cb67-40d1-a61d-2dcddec97f9a'; l record; who uuid; begin
  select * into l from public.vendor_links where id = v_link;
  if l.id is null then return; end if;
  who := public.org_admin(l.organization_id);
  if who is null then return; end if;
  insert into public.tasks (organization_id, title, notes, due_date, remind_at, assigned_to, vendor_id, auto_key)
  values (l.organization_id, 'Look at Coastal Pet invoice 8920 ($5,900.00)',
          'You asked to be reminded (Nov 12). This invoice is filed under Coastal Pet Supplies, but its number and amount match a paid Bill.com bill from Sticker Pack Inc. (invoice 8920, $5,900.00). It may be filed under the wrong vendor. Go to it opens the invoice.',
          current_date, now(), who, l.vendor_id, 'invoice_look:' || l.id)
  on conflict (organization_id, auto_key) where auto_key is not null do nothing;
end $$;
