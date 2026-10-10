\echo '>>> Artwork queue: not_vendor senders are skipped'
select pg_get_functiondef('public.mail_art_queue'::regproc) like '%not_vendor%' as skips_not_vendor;
