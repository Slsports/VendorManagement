-- 0075 — Artwork approvals read again with the stricter two-question check (artwork in this email? approval
-- asked?) on the more careful model. Unsettled flags are cleared as in 0074.
update public.review_items set status = 'accepted', resolved_at = now(), resolution_note = 'Read again: only delivered artwork counts'
 where kind = 'art_approval' and status = 'pending';
update public.email_threads set art_status = null, art_since = null, art_email_id = null, art_note = null where art_status in ('waiting', 'needs_changes');
update public.emails set art_needed = null, art_note = null, art_read_at = null where art_needed in ('yes', 'unsure')
   and thread_id in (select id from public.email_threads where art_status is null);
