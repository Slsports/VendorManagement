\echo '>>> 0266: no repeated number in file names'
select public.vendor_link_std_name('confirmation', '88198', '2026-10-27', 'SO 88198.xlsx') = 'Confirmation 88198 – Oct 27, 2026' as no_repeat;
select public.vendor_link_std_name('confirmation', null, '2026-02-28', 'SO-88198.pdf') = 'Confirmation – SO-88198 – Feb 28, 2026' as kept_without_number;
