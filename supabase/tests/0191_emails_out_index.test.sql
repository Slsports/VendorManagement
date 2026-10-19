\set ON_ERROR_STOP on
\pset footer off
\echo '>>> The sent-mail index for mail_answered exists'
select count(*) = 1 as has_index from pg_indexes where indexname = 'emails_out_after_idx';
