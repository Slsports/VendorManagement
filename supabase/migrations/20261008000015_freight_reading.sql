-- 0036 — Freight bills read by Claude (gmail-sync for mail with the PDF, freight-read for a PDF Trevor adds).
-- After a bill's lines are written: suggest each line's order (the vendor's newest order not yet received,
-- else its newest order), place the per-invoice fee on the biggest order, and open the bill for matching.
create or replace function public.freight_bill_loaded(p_bill uuid)
returns void
language plpgsql security definer
set search_path = public
as $$
begin
  update public.freight_bill_lines l
     set vendor_id = coalesce(l.vendor_id, l.suggested_vendor_id),
         order_id = coalesce(l.order_id, (
           select o.id from public.orders o
            where o.vendor_id = coalesce(l.vendor_id, l.suggested_vendor_id)
            order by (o.date_received is null) desc, coalesce(o.order_date, o.created_at::date) desc
            limit 1))
   where l.bill_id = p_bill and not l.confirmed;
  perform public.freight_place_fee(p_bill);
  update public.freight_bills set status = case when exists (select 1 from public.freight_bill_lines where bill_id = p_bill) then 'to_match' else 'failed' end,
         read_at = now()
   where id = p_bill;
end;
$$;
revoke execute on function public.freight_bill_loaded(uuid) from public, anon, authenticated;
grant execute on function public.freight_bill_loaded(uuid) to service_role;
grant execute on function public.freight_place_fee(uuid) to service_role;
grant execute on function public.freight_order_cost(uuid) to service_role;

-- A confirmed line also files the bill PDF in that vendor's files (Files > Freight bills).
create or replace function public.freight_line_files_pdf()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  b public.freight_bills%rowtype;
begin
  if new.confirmed and new.vendor_id is not null then
    select * into b from public.freight_bills where id = new.bill_id;
    if b.storage_path is not null and not exists (select 1 from public.vendor_links where vendor_id = new.vendor_id and storage_path = b.storage_path) then
      insert into public.vendor_links (organization_id, vendor_id, kind, label, storage_path, file_name, source, email_id, received_at, notes)
      values (new.organization_id, new.vendor_id, 'freight_bill',
              'Freight bill ' || coalesce(b.invoice_number, ''), b.storage_path, b.file_name, 'email', b.email_id,
              coalesce(b.invoice_date, current_date), 'Freight bill from ' || coalesce((select name from public.carriers where id = b.carrier_id), 'a carrier'));
    end if;
  end if;
  return null;
end;
$$;
drop trigger if exists freight_bill_lines_files_pdf on public.freight_bill_lines;
create trigger freight_bill_lines_files_pdf after insert or update of confirmed, vendor_id on public.freight_bill_lines
  for each row execute function public.freight_line_files_pdf();
revoke execute on function public.freight_line_files_pdf() from public, anon, authenticated;

alter table public.emails add column if not exists freight_checked_at timestamptz;
comment on column public.emails.freight_checked_at is 'When gmail-sync looked at this carrier email for a freight bill.';
