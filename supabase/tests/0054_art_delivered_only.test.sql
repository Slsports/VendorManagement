\echo '>>> Artwork queue gives attachment sizes; unsettled flags are read again'
select pg_get_functiondef('public.mail_art_queue'::regproc) like '%KB%' as sizes_given;
