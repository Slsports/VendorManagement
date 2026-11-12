-- The fixed-prices flag exists and defaults off.
begin;
do $$ declare f boolean; begin
  insert into public.vendors (organization_id, name) values ('00000000-0000-0000-0000-000000000001', 'Fixed 0352') returning fixed_prices into f;
  if f then raise exception 'default should be off'; end if;
end $$;
rollback;
