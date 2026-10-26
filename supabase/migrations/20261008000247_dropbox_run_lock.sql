-- 0247 — Dropbox read: one run at a time (Oct 26: runs every minute could overlap when a slice ran long, two workers
-- read the same files and together ran out of memory). A run takes the lock for 55 seconds; a run that finds it held does nothing.
alter table public.dropbox_connections add column if not exists run_lock_at timestamptz;
