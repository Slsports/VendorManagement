-- 0145 — Older Lightspeed history (Dana, Oct 17: "I frequently go back 3 or 4 years … we started on Lightspeed in May
-- 2020"). The copy began 24 months back (backfill_from). Once that pass is complete, ls-sync runs a second, older pass
-- for everything before older_to (= the original backfill_from), oldest first, with its own cursors, so the reports can
-- compare a big snow year with a slow one. older_to null means no older pass.
alter table public.ls_sync add column if not exists older_to timestamptz;
alter table public.ls_sync add column if not exists older_sales_cursor text;
alter table public.ls_sync add column if not exists older_lines_cursor text;
alter table public.ls_sync add column if not exists older_sales_done boolean not null default false;
alter table public.ls_sync add column if not exists older_lines_done boolean not null default false;
alter table public.ls_sync add column if not exists older_rows integer not null default 0;
comment on column public.ls_sync.older_to is 'Pull sales and lines older than this moment (the first copy''s start) once the first copy is complete; null = no older pass.';
update public.ls_sync set older_to = backfill_from where older_to is null;
