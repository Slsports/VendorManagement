-- 0384: a one-time set-up on the hosted data (Reef Sport's rep group); on a database without Reef Sport it changes nothing.
do $$
begin
  if exists (select 1 from public.vendors where id = '10bd730a-d8b9-46e1-9f43-a9ae06abad5b') then return; end if;
  if exists (select 1 from public.rep_groups where upper(name) = 'SANDBOXX GROUP') then raise exception 'unexpected rep group'; end if;
end $$;
