-- 0249: a Dropbox file may carry the carrier it is a bill from.
do $$
begin
  if not exists (select 1 from information_schema.columns where table_name = 'dropbox_files' and column_name = 'carrier_id') then raise exception 'carrier_id missing'; end if;
end $$;
