-- 0341 is a data fix for hosted rows; locally it must run cleanly and touch nothing that is not there.
begin;
do $$ begin
  if exists (select 1 from public.vendor_links where id = '81e8c191-6621-43ab-bf84-925e08af8544') then raise exception 'unexpected hosted row in the local test database'; end if;
end $$;
rollback;
