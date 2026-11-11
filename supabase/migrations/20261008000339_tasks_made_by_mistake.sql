-- 0339 — Tasks VMS made by mistake are hidden, not deleted (Dana, Nov 11): "when you close erroneous notifications I think
-- they should be deleted, not just closed. They clog up the activity feeds and other areas of vms." Deleting one would let
-- the rule that made it make it again (VMS remembers a task it already made by its closed row), and would lose the record,
-- so they stay in the table, marked closed_how = 'mistake', and no list, feed, calendar or notice shows them.
--   • Claude marks a task 'mistake' when Dana says it should never have been made; VMS marks its own wrong ones the same way
--     when a rule is fixed (Bill.com, 0340).
--   • A mistake never sends a "finished" notice to the person who gave it.
--   • Marked now: the 53 "Which order?" freight tasks (Nov 9) and the 6 "Enter … in Bill.com" tasks (Nov 10) Claude closed at
--     Dana's request.
set local lock_timeout = '5s';

alter table public.tasks drop constraint if exists tasks_closed_how_check;
alter table public.tasks add constraint tasks_closed_how_check check (closed_how in ('person', 'request', 'vms', 'mistake'));
comment on column public.tasks.closed_how is 'Who closed it: person (ticked done), request (Claude, at Dana''s request), vms (VMS on its own), mistake (should never have been made: hidden everywhere, kept so its rule does not make it again). Null while open.';

create or replace function public.tasks_closed_how() returns trigger
language plpgsql set search_path = public as $$
begin
  if new.done_at is null then
    new.closed_how := null;
  elsif new.closed_how = 'mistake' then
    -- hidden: nobody is told it was finished
    new.done_notified_at := coalesce(new.done_notified_at, now());
    new.done_seen_at := coalesce(new.done_seen_at, now());
  elsif new.done_by is not null then
    new.closed_how := 'person';
  else
    new.closed_how := case when new.closed_how = 'request' then 'request' else 'vms' end;
  end if;
  return new;
end;
$$;
revoke execute on function public.tasks_closed_how() from public, anon, authenticated;

update public.tasks set closed_how = 'mistake'
 where done_at is not null and closed_how = 'request'
   and ((auto_key like 'freightorder:%' and done_note like 'Closed at Dana''s request (Nov 9): Claude''s freight readings were too often wrong%')
     or (auto_key like 'billcom_enter:%' and done_note like 'Closed at Dana''s request (Nov 10)%'));
