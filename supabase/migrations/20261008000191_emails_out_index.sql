-- "Did one of us answer it?" (mail_answered, migration 190) looks at our sent mail after a date; with every year of
-- orders@ and Jarrett's mail coming in, keep that lookup quick.
create index if not exists emails_out_after_idx on public.emails (organization_id, received_at) where direction = 'out';
