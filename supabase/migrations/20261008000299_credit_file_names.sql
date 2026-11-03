-- 0299 — Credits say so in the name (Dana, Nov 3: "on credits lets do: 2025-10-06 PUKA CREATIONS CREDIT 228361 -$8.00.pdf").
set local lock_timeout = '5s';

create or replace function public.invoice_file_name(p_date date, p_vendor text, p_number text, p_total numeric, p_credit boolean) returns text
language sql immutable set search_path = '' as $$
  select left(regexp_replace(trim(regexp_replace(concat_ws(' ',
           to_char(p_date, 'YYYY-MM-DD'), nullif(trim(p_vendor), ''), case when p_credit then 'CREDIT' end, nullif(trim(p_number), ''),
           case when p_total is not null then (case when p_credit then '-' else '' end) || '$' || to_char(abs(p_total), 'FM999999990.00') end),
         '[/\\:*?"<>|]+', '-', 'g')), '\s+', ' ', 'g'), 180) || '.pdf'
$$;
grant execute on function public.invoice_file_name(date, text, text, numeric, boolean) to authenticated, service_role;

update public.vendor_links l
   set file_name = public.invoice_file_name(l.doc_date, v.name, l.doc_number, l.doc_total, true)
  from public.vendors v
 where v.id = l.vendor_id and l.kind = 'credit' and l.storage_path is not null
   and (l.notes like 'From Edenred%' or l.notes like 'From LaserVault%')
   and (l.doc_date is not null or l.doc_number is not null);
