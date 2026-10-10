\echo '>>> Artwork re-read: nothing left waiting from the old check'
select count(*) as waiting from public.email_threads where art_status = 'waiting';
