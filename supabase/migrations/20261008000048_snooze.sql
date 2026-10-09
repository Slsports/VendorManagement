-- 0069 — Snooze (Dana, Oct 9): "snooze an email or a review item for hours or days, and then it pops back into
-- my feed." A snooze is one person's: it hides a conversation or review item from that person's lists until
-- the time, then it comes back marked "Back from snooze" until they open it. A vendor reply to a snoozed
-- conversation ends the snooze at once. Everyone in the store can see who snoozed what and until when.
create table if not exists public.snoozes (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations(id) on delete cascade,
  profile_id       uuid not null references public.profiles(id) on delete cascade,
  thread_id        uuid references public.email_threads(id) on delete cascade,
  review_item_id   uuid references public.review_items(id) on delete cascade,
  until            timestamptz not null,
  woke_by_reply    boolean not null default false,
  created_at       timestamptz not null default now(),
  check (num_nonnulls(thread_id, review_item_id) = 1)
);
create unique index if not exists snoozes_thread_once on public.snoozes (profile_id, thread_id) where thread_id is not null;
create unique index if not exists snoozes_review_once on public.snoozes (profile_id, review_item_id) where review_item_id is not null;
create index if not exists snoozes_org_idx on public.snoozes (organization_id, until);

alter table public.snoozes enable row level security;
drop policy if exists "snoozes: members read" on public.snoozes;
create policy "snoozes: members read" on public.snoozes for select to authenticated using (public.user_in_org(organization_id));
drop policy if exists "snoozes: own insert" on public.snoozes;
create policy "snoozes: own insert" on public.snoozes for insert to authenticated with check (profile_id = auth.uid() and public.user_in_org(organization_id));
drop policy if exists "snoozes: own update" on public.snoozes;
create policy "snoozes: own update" on public.snoozes for update to authenticated using (profile_id = auth.uid()) with check (profile_id = auth.uid());
drop policy if exists "snoozes: own delete" on public.snoozes;
create policy "snoozes: own delete" on public.snoozes for delete to authenticated using (profile_id = auth.uid());
grant select, insert, update, delete on table public.snoozes to authenticated;
grant all on table public.snoozes to service_role;

-- A vendor writes back: every snooze on that conversation ends now.
create or replace function public.snooze_wake_on_reply() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.direction = 'in' then
    update public.snoozes set until = least(until, now()), woke_by_reply = true where thread_id = new.thread_id and until > now();
  end if;
  return new;
end;
$$;
drop trigger if exists emails_wake_snoozes on public.emails;
create trigger emails_wake_snoozes after insert on public.emails for each row execute function public.snooze_wake_on_reply();
