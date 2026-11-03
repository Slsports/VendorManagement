\set ON_ERROR_STOP on
\pset footer off
\echo '>>> 0299: credits: <date> <vendor> CREDIT <number> -<amount>'
select public.invoice_file_name(date '2025-10-22', 'WORLD FAMOUS SPORTS', '77872', 12176.85, false) = '2025-10-22 WORLD FAMOUS SPORTS 77872 $12176.85.pdf' as invoice,
       public.invoice_file_name(date '2025-10-15', 'WORLD FAMOUS SPORTS', 'C2500514', 136.74, true) = '2025-10-15 WORLD FAMOUS SPORTS CREDIT C2500514 -$136.74.pdf' as credit,
       public.invoice_file_name(null, 'A/B CO', 'I10299789/E', null, false) = 'A-B CO I10299789-E.pdf' as no_date_no_slash;
