-- 0374: a one-time clean-up of Reef Sport's records on the hosted data; on a database without them it changes nothing.
do $$
begin
  if exists (select 1 from public.vendors where id = '10bd730a-d8b9-46e1-9f43-a9ae06abad5b') then return; end if;
  if exists (select 1 from public.vendors where name = 'FAIRE/SANDBOXX/REEF SPORT SUNCARE') then raise exception 'unexpected vendor'; end if;
end $$;
