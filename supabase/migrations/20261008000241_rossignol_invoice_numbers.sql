-- 0241 — Rossignol paperwork filed accurately (Dana, Oct 24): two invoices were filed without their number, which is in
-- the file name ("Invoice_505500202788"). The number is filled in, so a payment email naming it marks it paid.

set local lock_timeout = '5s';

update public.vendor_links
   set doc_number = substring(label from '^Invoice_(\d{9,})')
 where vendor_id = '37dd4e44-b4fb-4d7a-934f-eee6b76d8ea6' and kind = 'invoice' and doc_number is null
   and label ~ '^Invoice_\d{9,}';
