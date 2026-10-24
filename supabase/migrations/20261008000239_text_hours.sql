-- 0239 — Texts only in working hours (Dana, Oct 24, after reminder texts at 12:46 am): "no one should receive texts
-- before 8am or after 6 pm unless they specifically set it that way themselves."
--   • profiles.text_from / text_until: each person's texting hours (Pacific), 8:00 to 18:00 unless they change them
--     (Tasks › How I get reminders).
--   • A reminder (or "done" note) due outside those hours still goes to the dashboard and email right away; its text
--     waits until the hours start (tasks.text_wait_until / done_text_wait_until), and is dropped if the task is done by then.

set local lock_timeout = '5s';

alter table public.profiles add column if not exists text_from time not null default '08:00';
alter table public.profiles add column if not exists text_until time not null default '18:00';
comment on column public.profiles.text_from is 'Texts start at this time (Pacific); set by the person (Dana, Oct 24: 8 am unless they choose otherwise).';
comment on column public.profiles.text_until is 'Texts stop at this time (Pacific); 6 pm unless the person chooses otherwise.';
alter table public.tasks add column if not exists text_wait_until timestamptz;
alter table public.tasks add column if not exists done_text_wait_until timestamptz;
comment on column public.tasks.text_wait_until is 'The reminder text waits until the person''s texting hours start.';
comment on column public.tasks.done_text_wait_until is 'The "done" text waits until the giver''s texting hours start.';
create index if not exists tasks_text_wait on public.tasks (text_wait_until) where text_wait_until is not null;
create index if not exists tasks_done_text_wait on public.tasks (done_text_wait_until) where done_text_wait_until is not null;
