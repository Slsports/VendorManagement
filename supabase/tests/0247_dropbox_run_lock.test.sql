-- 0247: the run lock column exists and starts empty.
do $$
begin
  if exists (select 1 from public.dropbox_connections where run_lock_at is not null) then raise exception 'run_lock_at should start empty'; end if;
  if not exists (select 1 from information_schema.columns where table_name = 'dropbox_connections' and column_name = 'run_lock_at') then raise exception 'run_lock_at missing'; end if;
end $$;
