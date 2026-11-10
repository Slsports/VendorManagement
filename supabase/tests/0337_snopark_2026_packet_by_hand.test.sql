-- The data fix only touches the live 2026-2027 season; locally there is none, so the migration must run clean on an empty table.
begin;
do $$ begin
  if exists (select 1 from public.snopark_seasons where label = '2026-2027') then raise exception 'unexpected season in the local database'; end if;
end $$;
rollback;
