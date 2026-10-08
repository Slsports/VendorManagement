-- 0037 — One freight bill per email as a plain unique constraint (the partial index could not serve the
-- sync's upsert), and look at the carrier mail again.
drop index if exists public.freight_bills_email_key;
alter table public.freight_bills drop constraint if exists freight_bills_email_id_key;
alter table public.freight_bills add constraint freight_bills_email_id_key unique (email_id);
update public.emails e set freight_checked_at = null
  from public.email_senders s
 where s.id = e.sender_id and s.kind = 'carrier' and e.freight_checked_at is not null
   and not exists (select 1 from public.freight_bills b where b.email_id = e.id);
