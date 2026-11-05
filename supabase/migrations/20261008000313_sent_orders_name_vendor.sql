-- Orders we email to an address VMS does not know (Dana, Nov 5): "If the vendor name is listed anywhere in the email or
-- the attachment it should attach it to that vendor." The sent-orders function now reads those emails too and matches
-- the vendor Claude names (vendor_by_name: names and aliases), saving the address as the vendor's Orders contact.
-- Back-check (CLAUDE.md "Filing changes re-check the old"): every sent email marked "no vendor" in the last 12 months goes
-- back in the queue to be sorted and read again.
update public.emails
   set order_scan = null, order_scanned_at = null
 where direction = 'out' and copy_of is null
   and order_scan->>'result' = 'no_vendor'
   and received_at > now() - interval '365 days';
