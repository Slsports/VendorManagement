-- 0054 — Keeping tabs while the staff learns (Dana, Oct 8).
--  * "Working on order": a conversation with a vendor flagged while an order goes back and forth. Each
--    person's flagged conversations are on their dashboard with a status: Needs an answer (the rep wrote
--    last), Waiting on rep (we wrote last), Working (set by hand), Completed (done; drops off the card).
--  * The Team page (admins): per person, what waits on them and for how long; red past 3 days.
alter table public.email_threads add column if not exists working_by uuid references public.profiles(id) on delete set null;
alter table public.email_threads add column if not exists working_since timestamptz;
alter table public.email_threads add column if not exists working_mark_at timestamptz;
alter table public.email_threads add column if not exists working_done_at timestamptz;
comment on column public.email_threads.working_by is 'Working on order: who flagged this conversation (it is on their dashboard).';
comment on column public.email_threads.working_mark_at is 'Set to Working by hand; a newer message from the vendor turns it back to Needs an answer.';
create index if not exists email_threads_working_idx on public.email_threads (organization_id, working_by) where working_by is not null;

-- p_action: flag · working · complete · reopen · unflag
create or replace function public.set_working_order(p_thread uuid, p_action text)
returns void
language plpgsql security definer
set search_path = public
as $$
declare t public.email_threads%rowtype;
begin
  if not public.user_can_edit() then raise exception 'Only admins, managers and buyers work on orders' using errcode = '42501'; end if;
  select * into t from public.email_threads where id = p_thread for update;
  if t.id is null or not public.user_in_org(t.organization_id) then raise exception 'Conversation not found' using errcode = '23503'; end if;
  if p_action = 'flag' then
    update public.email_threads set working_by = coalesce(working_by, auth.uid()), working_since = coalesce(working_since, now()), working_done_at = null where id = p_thread;
  elsif p_action = 'working' then
    update public.email_threads set working_by = coalesce(working_by, auth.uid()), working_since = coalesce(working_since, now()), working_mark_at = now(), working_done_at = null where id = p_thread;
  elsif p_action = 'complete' then
    update public.email_threads set working_done_at = now() where id = p_thread;
  elsif p_action = 'reopen' then
    update public.email_threads set working_done_at = null where id = p_thread;
  elsif p_action = 'unflag' then
    update public.email_threads set working_by = null, working_since = null, working_mark_at = null, working_done_at = null where id = p_thread;
  else
    raise exception 'Unknown action %', p_action using errcode = '22023';
  end if;
end;
$$;
revoke execute on function public.set_working_order(uuid, text) from public, anon;
grant execute on function public.set_working_order(uuid, text) to authenticated, service_role;

-- The Team page: one row per active person (not the test login).
create or replace function public.team_overview(p_org uuid)
returns table (
  profile_id uuid, full_name text, role text,
  needs integer, needs_oldest timestamptz, no_answer integer, no_answer_oldest timestamptz,
  reviews integer, reviews_oldest timestamptz, working integer, working_needs integer, vendors integer, last_sent timestamptz
)
language sql stable security definer
set search_path = public
as $$
  select p.id, p.full_name, p.role::text,
    (select count(*)::int from public.email_threads t where t.organization_id = p_org and t.owner_id = p.id and t.status = 'waiting_on_us' and t.view = 'attention'),
    (select min(coalesce(t.last_in_at, t.last_message_at)) from public.email_threads t where t.organization_id = p_org and t.owner_id = p.id and t.status = 'waiting_on_us' and t.view = 'attention'),
    (select count(*)::int from public.email_threads t where t.organization_id = p_org and t.owner_id = p.id and t.status = 'waiting_on_vendor' and t.follow_up_at < now()),
    (select min(t.follow_up_at) from public.email_threads t where t.organization_id = p_org and t.owner_id = p.id and t.status = 'waiting_on_vendor' and t.follow_up_at < now()),
    (select count(*)::int from public.review_items r where r.organization_id = p_org and r.assigned_to = p.id and r.status = 'pending'),
    (select min(r.created_at) from public.review_items r where r.organization_id = p_org and r.assigned_to = p.id and r.status = 'pending'),
    (select count(*)::int from public.email_threads t where t.organization_id = p_org and t.working_by = p.id and t.working_done_at is null),
    (select count(*)::int from public.email_threads t where t.organization_id = p_org and t.working_by = p.id and t.working_done_at is null and t.status = 'waiting_on_us'
        and (t.working_mark_at is null or t.last_in_at > t.working_mark_at)),
    (select count(*)::int from public.vendors v where v.organization_id = p_org and v.assigned_buyer_id = p.id and v.is_active),
    (select max(e.received_at) from public.emails e where e.organization_id = p_org and e.sent_by = p.id and e.direction = 'out')
  from public.profiles p
  where p.organization_id = p_org and p.is_active and public.is_admin() and public.user_in_org(p_org)
    and lower(p.email) not like 'claude-test@%'
  order by p.full_name
$$;
revoke execute on function public.team_overview(uuid) from public, anon;
grant execute on function public.team_overview(uuid) to authenticated, service_role;
