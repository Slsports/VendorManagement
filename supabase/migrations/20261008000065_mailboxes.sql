-- 0086 — Personal inboxes and the old Gmail (Dana, Oct 10–11). Besides the shared orders@ (mail_accounts), each
-- person gets their own mailbox in VMS (Dana, Trevor, Jarrett), private except to the admin, and Dana gets the
-- old shaverlakesports@gmail.com: it forwards to oldslsgmail@shaverlakesports.com, an extra address on orders@,
-- and VMS files that mail under its own mailbox. Claude reads all of them like orders@ (documents, artwork,
-- replies). mail_accounts stays the one shared mailbox; these live in mailboxes.
--   personal: synced from Gmail as that person (gmail_box = address)
--   legacy:   not synced itself; arrives in orders@ (gmail_box = orders@), found by its forwarding headers
create table if not exists public.mailboxes (
  id                  uuid primary key default gen_random_uuid(),
  organization_id     uuid not null references public.organizations(id) on delete cascade,
  kind                text not null check (kind in ('personal', 'legacy')),
  address             text not null,
  label               text not null,
  owner_id            uuid not null references public.profiles(id) on delete cascade,
  gmail_box           text not null,
  is_active           boolean not null default true,
  history_id          text,
  backfill_after      date,
  backfill_page_token text,
  backfill_done       boolean not null default false,
  last_sync_at        timestamptz,
  sync_started_at     timestamptz,
  last_error          text,
  last_error_at       timestamptz,
  messages_synced     integer not null default 0,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  unique (organization_id, address)
);
drop trigger if exists mailboxes_updated_at on public.mailboxes;
create trigger mailboxes_updated_at before update on public.mailboxes for each row execute function public.set_updated_at();

-- Who may see a mailbox's mail: its owner and the admin.
create or replace function public.can_see_mailbox(p_mailbox uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.mailboxes m where m.id = p_mailbox and public.user_in_org(m.organization_id) and (m.owner_id = auth.uid() or public.is_admin()))
$$;
revoke execute on function public.can_see_mailbox(uuid) from public, anon;
grant execute on function public.can_see_mailbox(uuid) to authenticated, service_role;

alter table public.mailboxes enable row level security;
drop policy if exists "mailboxes: owner and admin read" on public.mailboxes;
create policy "mailboxes: owner and admin read" on public.mailboxes for select to authenticated using (public.user_in_org(organization_id) and (owner_id = auth.uid() or public.is_admin()));
grant select on table public.mailboxes to authenticated;
grant all on table public.mailboxes to service_role;

-- Which mailbox each conversation and email belongs to (null = orders@), and which Gmail mailbox its ids live in.
alter table public.email_threads add column if not exists mailbox_id uuid references public.mailboxes(id) on delete cascade;
alter table public.email_threads add column if not exists shared_at timestamptz;
alter table public.email_threads add column if not exists shared_by uuid references public.profiles(id) on delete set null;
alter table public.emails add column if not exists mailbox_id uuid references public.mailboxes(id) on delete cascade;
alter table public.emails add column if not exists gmail_box text;
alter table public.emails add column if not exists copy_of uuid references public.emails(id) on delete set null;
update public.emails e set gmail_box = a.mailbox from public.mail_accounts a where a.organization_id = e.organization_id and e.gmail_box is null;
create index if not exists email_threads_mailbox_idx on public.email_threads (mailbox_id, last_message_at desc) where mailbox_id is not null;
create index if not exists emails_mailbox_idx on public.emails (mailbox_id) where mailbox_id is not null;
create index if not exists emails_message_id_idx on public.emails (organization_id, message_id_header) where message_id_header is not null;

-- The same email in orders@ and someone's own inbox: the second copy is marked, and Claude's file steps skip it.
create or replace function public.emails_mark_copy() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.message_id_header is not null and new.copy_of is null then
    select id into new.copy_of from public.emails
     where organization_id = new.organization_id and message_id_header = new.message_id_header
       and coalesce(gmail_box, '') <> coalesce(new.gmail_box, '') and copy_of is null
     order by received_at limit 1;
  end if;
  return new;
end;
$$;
drop trigger if exists emails_mark_copy on public.emails;
create trigger emails_mark_copy before insert on public.emails for each row execute function public.emails_mark_copy();

-- A conversation in someone's own mailbox is always theirs (no vendor rule, greeting or artwork step moves it).
create or replace function public.email_threads_mailbox_owner() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.mailbox_id is not null then
    new.owner_id := (select owner_id from public.mailboxes where id = new.mailbox_id);
  end if;
  return new;
end;
$$;
drop trigger if exists email_threads_mailbox_owner on public.email_threads;
create trigger email_threads_mailbox_owner before insert or update of owner_id, mailbox_id on public.email_threads
  for each row execute function public.email_threads_mailbox_owner();

-- Review cards carry subjects and snippets and everyone sees the review queue: none from private mail.
create or replace function public.review_items_skip_private_mail() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.entity_type = 'email_thread' and exists (select 1 from public.email_threads t where t.id = new.entity_id and t.mailbox_id is not null and t.shared_at is null) then
    return null;
  end if;
  return new;
end;
$$;
drop trigger if exists review_items_skip_private_mail on public.review_items;
create trigger review_items_skip_private_mail before insert on public.review_items for each row execute function public.review_items_skip_private_mail();

-- Privacy: mail in a personal or legacy mailbox is seen by its owner and the admin, or by everyone once shared to Orders.
drop policy if exists "email_threads: members read" on public.email_threads;
create policy "email_threads: members read" on public.email_threads for select to authenticated
  using (public.user_in_org(organization_id) and (mailbox_id is null or shared_at is not null or public.can_see_mailbox(mailbox_id)));
drop policy if exists "emails: members read" on public.emails;
create policy "emails: members read" on public.emails for select to authenticated
  using (public.user_in_org(organization_id) and (mailbox_id is null or public.can_see_mailbox(mailbox_id)
         or exists (select 1 from public.email_threads t where t.id = emails.thread_id and t.shared_at is not null)));
drop policy if exists "email_attachments: members read" on public.email_attachments;
create policy "email_attachments: members read" on public.email_attachments for select to authenticated
  using (public.user_in_org(organization_id) and exists (select 1 from public.emails e where e.id = email_attachments.email_id));

-- "Share to Orders": a conversation from someone's own inbox joins the shared Orders mail (it stays theirs).
create or replace function public.share_thread_to_orders(p_thread uuid, p_share boolean default true)
returns void
language plpgsql security definer set search_path = public as $$
declare t public.email_threads%rowtype;
begin
  if not public.user_can_edit() then raise exception 'Only admins, managers and buyers handle mail' using errcode = '42501'; end if;
  select * into t from public.email_threads where id = p_thread for update;
  if t.id is null or t.mailbox_id is null or not public.can_see_mailbox(t.mailbox_id) then raise exception 'Conversation not found' using errcode = '23503'; end if;
  update public.email_threads set shared_at = case when p_share then now() end, shared_by = case when p_share then auth.uid() end where id = p_thread;
end;
$$;
revoke execute on function public.share_thread_to_orders(uuid, boolean) from public, anon;
grant execute on function public.share_thread_to_orders(uuid, boolean) to authenticated, service_role;

-- The team page counts the shared Orders mail only.
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
    (select count(*)::int from public.email_threads t where t.organization_id = p_org and t.deleted_at is null and (t.mailbox_id is null or t.shared_at is not null) and t.owner_id = p.id and t.status = 'waiting_on_us' and t.view = 'attention'),
    (select min(coalesce(t.last_in_at, t.last_message_at)) from public.email_threads t where t.organization_id = p_org and t.deleted_at is null and (t.mailbox_id is null or t.shared_at is not null) and t.owner_id = p.id and t.status = 'waiting_on_us' and t.view = 'attention'),
    (select count(*)::int from public.email_threads t where t.organization_id = p_org and t.deleted_at is null and (t.mailbox_id is null or t.shared_at is not null) and t.owner_id = p.id and t.status = 'waiting_on_vendor' and t.follow_up_at < now()),
    (select min(t.follow_up_at) from public.email_threads t where t.organization_id = p_org and t.deleted_at is null and (t.mailbox_id is null or t.shared_at is not null) and t.owner_id = p.id and t.status = 'waiting_on_vendor' and t.follow_up_at < now()),
    (select count(*)::int from public.review_items r where r.organization_id = p_org and r.assigned_to = p.id and r.status = 'pending'),
    (select min(r.created_at) from public.review_items r where r.organization_id = p_org and r.assigned_to = p.id and r.status = 'pending'),
    (select count(*)::int from public.email_threads t where t.organization_id = p_org and t.deleted_at is null and t.working_by = p.id and t.working_done_at is null),
    (select count(*)::int from public.email_threads t where t.organization_id = p_org and t.deleted_at is null and t.working_by = p.id and t.working_done_at is null and t.status = 'waiting_on_us'
        and (t.working_mark_at is null or t.last_in_at > t.working_mark_at)),
    (select count(*)::int from public.vendors v where v.organization_id = p_org and v.assigned_buyer_id = p.id and v.is_active),
    (select max(e.received_at) from public.emails e where e.organization_id = p_org and e.sent_by = p.id and e.direction = 'out' and e.mailbox_id is null)
  from public.profiles p
  where p.organization_id = p_org and p.is_active and public.is_admin() and public.user_in_org(p_org)
    and lower(p.email) not like 'claude-test@%'
  order by p.full_name
$$;
revoke execute on function public.team_overview(uuid) from public, anon;
grant execute on function public.team_overview(uuid) to authenticated, service_role;
