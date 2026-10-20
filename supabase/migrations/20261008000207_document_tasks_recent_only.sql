-- 0207 — Tasks only for new paper (Dana, Oct 20: yes to closing the old ones and making no more). Loading past mail filed
-- proofs and credits from 2023-2026 and each became a to-do. A proof or credit gets its task only when it came in within
-- the last 30 days; older ones are history. The 88 open tasks for files more than 60 days old are closed.
do $$
declare src text;
begin
  select pg_get_functiondef('public.vendor_links_next_step()'::regprocedure) into src;
  if position('if new.kind = ''proof'' and (tg_op = ''INSERT'' or old.kind is distinct from ''proof'') then' in src) = 0
     or position('if new.kind = ''credit'' and (tg_op = ''INSERT'' or old.kind is distinct from ''credit'') then' in src) = 0 then
    raise exception 'vendor_links_next_step changed; update this migration';
  end if;
  src := replace(src, 'if new.kind = ''proof'' and (tg_op = ''INSERT'' or old.kind is distinct from ''proof'') then',
                      'if new.kind = ''proof'' and (tg_op = ''INSERT'' or old.kind is distinct from ''proof'') and coalesce(new.received_at, current_date) >= current_date - 30 then');
  src := replace(src, 'if new.kind = ''credit'' and (tg_op = ''INSERT'' or old.kind is distinct from ''credit'') then',
                      'if new.kind = ''credit'' and (tg_op = ''INSERT'' or old.kind is distinct from ''credit'') and coalesce(new.received_at, current_date) >= current_date - 30 then');
  execute src;
end $$;

do $$
declare n int;
begin
  update public.tasks t set done_at = now(), done_note = 'Old paper filed from past mail; closed at Dana''s request (Oct 20, 2026).'
    from public.vendor_links l
   where t.done_at is null and t.auto_key in ('proof:' || l.id, 'credit:' || l.id) and l.received_at < date '2026-10-20' - 60;
  get diagnostics n = row_count;
  raise notice 'closed % old proof and credit tasks', n;
end $$;
