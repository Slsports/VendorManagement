-- 0205 — Dates always show the year (Dana, Oct 20: "anywhere a date shows I want year also"). The pay-by reminders
-- were titled "Pay Pucci by Oct 26 …"; now "Pay Pucci by Oct 26, 2026 …". Open reminders are renamed on the next sync.
do $$
declare src text;
begin
  select pg_get_functiondef('public.sync_payment_tasks(uuid)'::regprocedure) into src;
  if position('''Mon FMDD'')' in src) = 0 then raise exception 'sync_payment_tasks changed; update this migration'; end if;
  src := replace(src, '''Mon FMDD'')', '''Mon FMDD, YYYY'')');
  execute src;
end $$;
select public.sync_payment_tasks();
