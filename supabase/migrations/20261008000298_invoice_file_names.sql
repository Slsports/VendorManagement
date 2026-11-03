-- 0298 — Invoice file names (Dana, Nov 3: "I want invoice date first: <date> <vendor> <invoice #> <amount> go!").
--   Edenred and LaserVault send every file as "Invoice.PDF" or a bare number, so Download all gave Invoice.PDF,
--   2-Invoice.PDF … Every invoice and credit VMS files from them is named "2025-10-22 WORLD FAMOUS SPORTS 77872 $12176.85.pdf"
--   (a credit's amount with a minus). Back-fix of the ones on file.
set local lock_timeout = '5s';

create or replace function public.invoice_file_name(p_date date, p_vendor text, p_number text, p_total numeric, p_credit boolean) returns text
language sql immutable set search_path = '' as $$
  select left(regexp_replace(trim(regexp_replace(concat_ws(' ',
           to_char(p_date, 'YYYY-MM-DD'), nullif(trim(p_vendor), ''), nullif(trim(p_number), ''),
           case when p_total is not null then (case when p_credit then '-' else '' end) || '$' || to_char(abs(p_total), 'FM999999990.00') end),
         '[/\\:*?"<>|]+', '-', 'g')), '\s+', ' ', 'g'), 180) || '.pdf'
$$;
grant execute on function public.invoice_file_name(date, text, text, numeric, boolean) to authenticated, service_role;

update public.vendor_links l
   set file_name = public.invoice_file_name(l.doc_date, v.name, l.doc_number, l.doc_total, l.kind = 'credit')
  from public.vendors v
 where v.id = l.vendor_id and l.kind in ('invoice', 'credit') and l.storage_path is not null
   and (l.notes like 'From Edenred%' or l.notes like 'From LaserVault%' or l.notes like 'WWD %From the old system%')
   and (l.doc_date is not null or l.doc_number is not null);
