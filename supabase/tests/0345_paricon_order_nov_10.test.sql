-- 0345 is a data fix for hosted rows; locally it must run cleanly and change nothing.
begin;
do $$ begin
  if exists (select 1 from public.orders where id = '3d380dce-90f7-4981-b40d-b8d6142f2f31') then raise exception 'unexpected hosted row locally'; end if;
end $$;
rollback;
