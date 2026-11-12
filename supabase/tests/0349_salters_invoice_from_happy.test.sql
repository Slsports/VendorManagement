-- 0349 is a data fix for one hosted invoice; locally it must run cleanly and change nothing.
begin;
do $$ begin
  if exists (select 1 from public.vendor_links where id = '5701204e-0dd7-4ce2-b825-59769486b8cc') then raise exception 'unexpected hosted row locally'; end if;
end $$;
rollback;
