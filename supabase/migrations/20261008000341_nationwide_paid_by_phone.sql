-- 0341 — Nationwide 32962 ($745.00) and 32968 ($533.50) were paid (Dana, Nov 11: "PLEASE CHECK Nationwide … I feel like these
-- were paid" … "yes go"). Dana's Sep 28 email to Lorenne: "I paid them over the phone by credit card on 9/23/26. Can you
-- please delete those bills in Bill.com?" VMS read that email (payment_notices, paid 9/23, credit card by phone) but it named
-- no invoice numbers, so nothing was marked, and Claude forwarded both to the Bill.com inbox on Nov 10 by mistake (Dana is
-- deleting them there).
--   • Both invoices are marked paid 9/23/26, credit card by phone, with the email one click away.
--   • Their "Enter … in Bill.com" tasks close as made by mistake (0339: hidden).
--   • A note on Nationwide: from Sep 15, 2026 they no longer take payment through the WWD portal (Lorenne: check, or Bill.com).
set local lock_timeout = '5s';

update public.vendor_links set paid_at = '2026-09-23', paid_how = 'Credit card by phone',
       paid_email_id = '97bf19b4-a798-4f5f-81d5-59ca326f48a0', paid_thread_id = 'acbc0a8b-d61e-4246-9f0a-8ecfed1bcf12'
 where id in ('81e8c191-6621-43ab-bf84-925e08af8544', '8760082e-dc90-4edc-ab78-1eea60452f5d') and paid_at is null;

update public.payment_notices set marked = 2
 where email_id = '97bf19b4-a798-4f5f-81d5-59ca326f48a0' and marked = 0
   and exists (select 1 from public.vendor_links where id = '81e8c191-6621-43ab-bf84-925e08af8544');

update public.tasks set done_at = now(), closed_how = 'mistake',
       done_note = 'Made by mistake (Dana, Nov 11): Dana paid this invoice by credit card over the phone on 9/23/26 (her Sep 28 email to Nationwide). Not to be paid in Bill.com.'
 where auto_key in ('billcom_enter:81e8c191-6621-43ab-bf84-925e08af8544', 'billcom_enter:8760082e-dc90-4edc-ab78-1eea60452f5d') and done_at is null;

insert into public.notes (organization_id, entity_type, entity_id, body)
select v.organization_id, 'vendor', v.id,
       'Paying Nationwide: since Sep 15, 2026 they no longer take payment through the WWD portal (Lorenne''s email). Pay by check or in Bill.com. Their last WWD invoices were Jan 27, 2026. 32962 and 32968 were paid by credit card over the phone on 9/23/26.'
  from public.vendors v
 where v.id = '3c0b4e19-e2ce-4d23-8d78-0db2734409ca'
   and not exists (select 1 from public.notes n where n.entity_type = 'vendor' and n.entity_id = v.id and n.body like 'Paying Nationwide:%');
