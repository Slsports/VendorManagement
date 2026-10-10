-- 0038 — Freight bills from replies and reminders were not new bills, and PartnerShip's " - 792862" is its
-- customer number, not an invoice number. Start the bills that wait for a PDF over; the sync re-reads the mail.
delete from public.freight_bills b where b.status = 'needs_pdf' and b.storage_path is null
  and not exists (select 1 from public.freight_bill_lines l where l.bill_id = b.id);
update public.emails e set freight_checked_at = null
  from public.email_senders s
 where s.id = e.sender_id and s.kind = 'carrier'
   and not exists (select 1 from public.freight_bills b where b.email_id = e.id);
