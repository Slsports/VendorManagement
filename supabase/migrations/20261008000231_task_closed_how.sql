-- 0231 — Who closed a task (Dana, Oct 23): "I would like the 'Done' group of tasks to only be ones I have actually completed
-- and you can have another tab for ones that you closed because I asked you to" … "lets keep them separate: Closed at your
-- request & Closed by VMS - I will want to check all the closed by vms for a while to make sure that is functioning the
-- way its supposed to."
--   person  — someone ticked it done (done_by set): the Done tab
--   request — Claude closed it because Dana asked (set by hand when closing them): Closed at your request
--   vms     — VMS closed it on its own (paid, renewal on file, PO approved, re-check): Closed by VMS

set local lock_timeout = '5s';

alter table public.tasks add column if not exists closed_how text check (closed_how in ('person', 'request', 'vms'));
comment on column public.tasks.closed_how is 'Who closed it: person (ticked done), request (Claude, at Dana''s request), vms (VMS on its own). Null while open.';

create or replace function public.tasks_closed_how() returns trigger
language plpgsql set search_path = public as $$
begin
  if new.done_at is null then
    new.closed_how := null;
  elsif new.done_by is not null then
    new.closed_how := 'person';
  else
    new.closed_how := case when new.closed_how = 'request' then 'request' else 'vms' end;
  end if;
  return new;
end;
$$;
revoke execute on function public.tasks_closed_how() from public, anon, authenticated;
drop trigger if exists tasks_closed_how on public.tasks;
create trigger tasks_closed_how before insert or update of done_at, done_by, closed_how on public.tasks for each row execute function public.tasks_closed_how();

-- the 120 closed so far: none ticked by a person; 96 closed at Dana's request (old paperwork, old proofs, two credits)
update public.tasks set closed_how = case when done_by is not null then 'person' when done_note ilike '%request%' then 'request' else 'vms' end
 where done_at is not null and closed_how is null;
