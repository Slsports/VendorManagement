-- 0059 — Delete mail (Dana, Oct 9): a conversation moves to Gmail's Trash for orders@ (emptied after 30
-- days) and leaves every list in VMS. The Deleted tab shows who deleted what and when, with Restore.
-- Files already saved to a vendor stay. A new message in a deleted conversation brings it back.
alter table public.email_threads add column if not exists deleted_at timestamptz;
alter table public.email_threads add column if not exists deleted_by uuid references public.profiles(id) on delete set null;
create index if not exists email_threads_deleted_idx on public.email_threads (organization_id, deleted_at) where deleted_at is not null;

-- gmail-read calls this after Gmail moved the conversation to (or out of) the Trash.
create or replace function public.mark_threads_deleted(p_threads uuid[], p_by uuid, p_deleted boolean)
returns integer language plpgsql security definer set search_path = public as $$
declare n integer;
begin
  update public.email_threads set deleted_at = case when p_deleted then now() end, deleted_by = case when p_deleted then p_by end
   where id = any (p_threads) and (deleted_at is null) = p_deleted;
  get diagnostics n = row_count;
  return n;
end;
$$;
revoke execute on function public.mark_threads_deleted(uuid[], uuid, boolean) from public, anon, authenticated;
grant execute on function public.mark_threads_deleted(uuid[], uuid, boolean) to service_role;

create or replace function public.emails_undelete_thread()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  update public.email_threads set deleted_at = null, deleted_by = null where id = new.thread_id and deleted_at is not null;
  return null;
end;
$$;
drop trigger if exists emails_undelete_thread on public.emails;
create trigger emails_undelete_thread after insert on public.emails for each row execute function public.emails_undelete_thread();
revoke execute on function public.emails_undelete_thread() from public, anon, authenticated;

-- Deleted conversations are not waiting on anyone.
create or replace function public.mail_reply_queue(p_org uuid, p_limit integer default 20)
returns table (email_id uuid, thread_id uuid, subject text, from_email text, from_name text, body_text text, sender_kind text, carrier text)
language sql stable security definer
set search_path = public
as $$
  select e.id, e.thread_id, e.subject, e.from_email, e.from_name, left(coalesce(e.body_text, e.snippet, ''), 6000), s.kind, c.name
    from public.email_threads t
    join lateral (select * from public.emails x where x.thread_id = t.id and x.direction <> 'internal' order by x.received_at desc limit 1) e on true
    left join public.email_senders s on s.id = e.sender_id
    left join public.carriers c on c.id = s.carrier_id
   where t.organization_id = p_org and t.status = 'waiting_on_us' and t.deleted_at is null and e.direction = 'in' and e.reply_read_at is null
   order by e.received_at desc
   limit p_limit
$$;

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
    (select count(*)::int from public.email_threads t where t.organization_id = p_org and t.deleted_at is null and t.owner_id = p.id and t.status = 'waiting_on_us' and t.view = 'attention'),
    (select min(coalesce(t.last_in_at, t.last_message_at)) from public.email_threads t where t.organization_id = p_org and t.deleted_at is null and t.owner_id = p.id and t.status = 'waiting_on_us' and t.view = 'attention'),
    (select count(*)::int from public.email_threads t where t.organization_id = p_org and t.deleted_at is null and t.owner_id = p.id and t.status = 'waiting_on_vendor' and t.follow_up_at < now()),
    (select min(t.follow_up_at) from public.email_threads t where t.organization_id = p_org and t.deleted_at is null and t.owner_id = p.id and t.status = 'waiting_on_vendor' and t.follow_up_at < now()),
    (select count(*)::int from public.review_items r where r.organization_id = p_org and r.assigned_to = p.id and r.status = 'pending'),
    (select min(r.created_at) from public.review_items r where r.organization_id = p_org and r.assigned_to = p.id and r.status = 'pending'),
    (select count(*)::int from public.email_threads t where t.organization_id = p_org and t.deleted_at is null and t.working_by = p.id and t.working_done_at is null),
    (select count(*)::int from public.email_threads t where t.organization_id = p_org and t.deleted_at is null and t.working_by = p.id and t.working_done_at is null and t.status = 'waiting_on_us'
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
