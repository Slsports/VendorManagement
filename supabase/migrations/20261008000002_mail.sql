-- 0023 — Mail: the orders@ mailbox inside VMS (docs/gmail-connection.md; decisions log Oct 7–8).
-- The gmail-sync Edge Function copies the last 12 months of orders@ into these tables and keeps them
-- current. Mail is shared: every member reads every thread; ownership only decides whose list a thread
-- lands on. Matching to vendors never guesses: confirmed senders, known contact addresses and the thread
-- link mail automatically; everything else becomes one proposal per sender in the review queue
-- ("@wfsports.com looks like World Famous Sports, named in 38 of 42 emails").

-- ---- the mailbox and its settings ---------------------------------------------
create table if not exists public.mail_accounts (
  organization_id     uuid primary key references public.organizations(id) on delete cascade,
  mailbox             text not null,                              -- orders@shaverlakesports.com
  internal_domains    text[] not null default '{}',               -- our own domains: never vendors
  history_id          text,                                       -- Gmail history cursor for incremental sync
  backfill_after      date,                                       -- first sync goes back to here (12 months)
  backfill_page_token text,
  backfill_done       boolean not null default false,
  follow_up_days      integer not null default 5 check (follow_up_days between 1 and 60),
  last_sync_at        timestamptz,
  sync_started_at     timestamptz,                                -- a run in progress; others skip
  last_error          text,
  last_error_at       timestamptz,
  messages_synced     integer not null default 0,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);
comment on table public.mail_accounts is 'The mailbox VMS reads and sends from, sync cursors and mail settings (follow-up days).';
drop trigger if exists mail_accounts_set_updated_at on public.mail_accounts;
create trigger mail_accounts_set_updated_at before update on public.mail_accounts for each row execute function public.set_updated_at();

-- ---- who mail comes from ------------------------------------------------------
-- One row per sending company: the domain (wfsports.com), or the full address for free-mail senders
-- (gmail.com etc). A person decides once what the sender is; later mail follows that answer.
create table if not exists public.email_senders (
  id                  uuid primary key default gen_random_uuid(),
  organization_id     uuid not null references public.organizations(id) on delete cascade,
  sender_key          text not null,                              -- lower-case domain, or address for free mail
  is_domain           boolean not null default true,
  kind                text not null default 'unknown' check (kind in ('unknown', 'vendor', 'rep_group', 'not_vendor', 'internal')),
  vendor_id           uuid references public.vendors(id) on delete set null,
  rep_group_id        uuid references public.rep_groups(id) on delete set null,
  display_name        text,                                       -- last From name seen
  domain_vendor_ids   uuid[] not null default '{}',               -- vendors whose name the domain looks like
  message_count       integer not null default 0,
  last_seen_at        timestamptz,
  proposed_vendor_id  uuid references public.vendors(id) on delete set null,
  proposal_note       text,
  review_item_id      uuid references public.review_items(id) on delete set null,
  decided_by          uuid references public.profiles(id) on delete set null,
  decided_at          timestamptz,
  created_at          timestamptz not null default now(),
  unique (organization_id, sender_key),
  check (kind <> 'vendor' or vendor_id is not null),
  check (kind <> 'rep_group' or rep_group_id is not null)
);
comment on table public.email_senders is 'What each sending domain (or free-mail address) is: a vendor, a rep group (matched per email), not a vendor, or ours.';
create index if not exists email_senders_vendor_idx on public.email_senders (vendor_id);

-- ---- conversations ------------------------------------------------------------
create table if not exists public.email_threads (
  id                  uuid primary key default gen_random_uuid(),
  organization_id     uuid not null references public.organizations(id) on delete cascade,
  gmail_thread_id     text not null,
  vendor_id           uuid references public.vendors(id) on delete set null,
  owner_id            uuid references public.profiles(id) on delete set null,
  owner_set_at        timestamptz,
  status              text not null default 'waiting_on_us' check (status in ('waiting_on_us', 'waiting_on_vendor', 'handled')),
  subject             text,
  message_count       integer not null default 0,
  last_in_at          timestamptz,
  last_out_at         timestamptz,
  last_message_at     timestamptz,
  follow_up_at        timestamptz,                                -- waiting on the vendor: nudge the owner after this
  status_msg_at       timestamptz,                                -- newest message the status already reflects
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  unique (organization_id, gmail_thread_id)
);
comment on table public.email_threads is 'One Gmail conversation. Ownership and status live here; every message in the thread follows the owner.';
create index if not exists email_threads_owner_idx on public.email_threads (organization_id, owner_id, status, last_message_at desc);
create index if not exists email_threads_vendor_idx on public.email_threads (vendor_id, last_message_at desc);
create index if not exists email_threads_recent_idx on public.email_threads (organization_id, last_message_at desc);
drop trigger if exists email_threads_set_updated_at on public.email_threads;
create trigger email_threads_set_updated_at before update on public.email_threads for each row execute function public.set_updated_at();

-- ---- messages -----------------------------------------------------------------
create table if not exists public.emails (
  id                   uuid primary key default gen_random_uuid(),
  organization_id      uuid not null references public.organizations(id) on delete cascade,
  gmail_id             text not null,
  thread_id            uuid not null references public.email_threads(id) on delete cascade,
  message_id_header    text,                                      -- RFC Message-ID, for replies
  in_reply_to          text,
  direction            text not null check (direction in ('in', 'out', 'internal')),
  from_email           text,
  from_name            text,
  to_emails            text[] not null default '{}',
  cc_emails            text[] not null default '{}',
  subject              text,
  snippet              text,
  body_text            text,                                      -- plain text, capped by the sync (about 20 KB)
  received_at          timestamptz not null,
  labels               text[] not null default '{}',             -- Gmail label names
  has_attachments      boolean not null default false,
  sender_id            uuid references public.email_senders(id) on delete set null,  -- the other party
  vendor_id            uuid references public.vendors(id) on delete set null,
  order_id             uuid references public.orders(id) on delete set null,
  mentioned_vendor_ids uuid[] not null default '{}',             -- vendors named in subject, body (above the signature) or file names
  match_how            text check (match_how in ('thread', 'sender', 'domain', 'directory', 'rep_group', 'manual')),
  sent_by              uuid references public.profiles(id) on delete set null,  -- sent from VMS by this person
  created_at           timestamptz not null default now(),
  unique (organization_id, gmail_id)
);
comment on table public.emails is 'Messages from the orders@ mailbox (last 12 months and onward). Bodies are plain text; the formatted view is fetched from Gmail when opened.';
create index if not exists emails_thread_idx on public.emails (thread_id, received_at);
create index if not exists emails_vendor_idx on public.emails (vendor_id, received_at desc);
create index if not exists emails_sender_idx on public.emails (sender_id);
create index if not exists emails_unmatched_idx on public.emails (organization_id, received_at desc) where vendor_id is null;

create table if not exists public.email_attachments (
  id                   uuid primary key default gen_random_uuid(),
  organization_id      uuid not null references public.organizations(id) on delete cascade,
  email_id             uuid not null references public.emails(id) on delete cascade,
  gmail_attachment_id  text,
  part_id              text,
  file_name            text not null,
  mime_type            text,
  size                 bigint,
  storage_path         text,                                      -- set once copied into vendor-files
  vendor_link_id       uuid references public.vendor_links(id) on delete set null,
  created_at           timestamptz not null default now()
);
create index if not exists email_attachments_email_idx on public.email_attachments (email_id);

-- ---- signatures and the Needs list -----------------------------------------------
alter table public.profiles add column if not exists email_signature text;
comment on column public.profiles.email_signature is 'Added under mail this person sends from orders@ through VMS.';

create table if not exists public.needs (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations(id) on delete cascade,
  title            text not null,
  requester        text,
  store_code       text,
  status           text not null default 'needed' check (status in ('needed', 'ordered', 'received')),
  email_id         uuid references public.emails(id) on delete set null,
  order_id         uuid references public.orders(id) on delete set null,
  notes            text,
  created_by       uuid references public.profiles(id) on delete set null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
comment on table public.needs is 'Staff requests that are not vendor orders (decisions log Oct 6). Fed by the Gmail label "Need to Order".';
create index if not exists needs_org_status_idx on public.needs (organization_id, status, created_at desc);
drop trigger if exists needs_set_updated_at on public.needs;
create trigger needs_set_updated_at before update on public.needs for each row execute function public.set_updated_at();

-- ---- helpers ------------------------------------------------------------------
create or replace function public.mail_is_freemail(p_domain text)
returns boolean language sql immutable as $$
  select lower(coalesce(p_domain, '')) in ('gmail.com', 'googlemail.com', 'yahoo.com', 'ymail.com', 'outlook.com', 'hotmail.com', 'live.com', 'msn.com', 'icloud.com', 'me.com', 'mac.com', 'aol.com', 'comcast.net', 'att.net', 'sbcglobal.net', 'verizon.net', 'protonmail.com', 'proton.me')
$$;

create or replace function public.mail_domain(p_email text)
returns text language sql immutable as $$
  select nullif(lower(split_part(coalesce(p_email, ''), '@', 2)), '')
$$;

-- Who owns a thread when nobody has taken it: an Assigned/<First name> Gmail label, else whoever sent from
-- VMS, else the review assignment rules for the vendor (fishing vendors go to Jarrett).
create or replace function public.mail_default_owner(p_thread uuid)
returns uuid
language plpgsql stable security definer
set search_path = public
as $$
declare
  t      public.email_threads%rowtype;
  v_name text;
  v_id   uuid;
begin
  select * into t from public.email_threads where id = p_thread;
  select substring(l from '^Assigned/(.+)$') into v_name
    from public.emails e, unnest(e.labels) l
   where e.thread_id = p_thread and l like 'Assigned/%'
   order by e.received_at desc limit 1;
  if v_name is not null then
    select p.id into v_id from public.profiles p
     where p.organization_id = t.organization_id and p.is_active and lower(p.full_name) like lower(trim(v_name)) || '%'
     order by p.full_name limit 1;
    if v_id is not null then return v_id; end if;
  end if;
  select e.sent_by into v_id from public.emails e where e.thread_id = p_thread and e.sent_by is not null order by e.received_at limit 1;
  if v_id is not null then return v_id; end if;
  if t.vendor_id is not null then
    return public.review_assignee_for(t.organization_id, 'email', 'vendor', t.vendor_id, '{}'::jsonb);
  end if;
  return null;
end;
$$;

-- Recompute a thread from its messages. Status follows the newest message unless a person already
-- answered for it (marked handled, or set it by hand) after that message arrived. p_backfill: history is
-- being loaded, so threads quiet for a week start out handled instead of flooding everyone's list.
create or replace function public.mail_refresh_thread(p_thread uuid, p_backfill boolean default false)
returns void
language plpgsql security definer
set search_path = public
as $$
declare
  t        public.email_threads%rowtype;
  last_e   public.emails%rowtype;
  v_vendor uuid;
  v_days   integer;
  v_owner  uuid;
begin
  select * into t from public.email_threads where id = p_thread for update;
  if not found then return; end if;
  if t.vendor_id is null then
    select vendor_id into v_vendor from public.emails where thread_id = p_thread and vendor_id is not null
     group by vendor_id order by count(*) desc, max(received_at) desc limit 1;
  end if;
  update public.email_threads th set
    vendor_id       = coalesce(th.vendor_id, v_vendor),
    message_count   = (select count(*) from public.emails where thread_id = p_thread),
    subject         = coalesce(th.subject, (select subject from public.emails where thread_id = p_thread order by received_at limit 1)),
    last_in_at      = (select max(received_at) from public.emails where thread_id = p_thread and direction = 'in'),
    last_out_at     = (select max(received_at) from public.emails where thread_id = p_thread and direction = 'out'),
    last_message_at = (select max(received_at) from public.emails where thread_id = p_thread)
  where th.id = p_thread
  returning * into t;

  select * into last_e from public.emails where thread_id = p_thread and direction <> 'internal' order by received_at desc limit 1;
  if last_e.id is not null and last_e.received_at > coalesce(t.status_msg_at, '-infinity'::timestamptz) then
    select follow_up_days into v_days from public.mail_accounts where organization_id = t.organization_id;
    update public.email_threads set
      status = case when p_backfill and last_e.received_at < now() - interval '7 days' then 'handled'
                    when last_e.direction = 'in' then 'waiting_on_us' else 'waiting_on_vendor' end,
      follow_up_at = case when last_e.direction = 'out' and not (p_backfill and last_e.received_at < now() - interval '7 days')
                          then last_e.received_at + make_interval(days => coalesce(v_days, 5)) end,
      status_msg_at = last_e.received_at
    where id = p_thread;
  end if;

  -- Fill the owner once there is one to give; every later message follows it.
  if t.owner_id is null then
    v_owner := public.mail_default_owner(p_thread);
    if v_owner is not null then update public.email_threads set owner_id = v_owner, owner_set_at = now() where id = p_thread; end if;
  end if;

  -- Messages in a vendor's thread belong to that vendor.
  update public.emails e set vendor_id = t.vendor_id, match_how = 'thread'
   where e.thread_id = p_thread and e.vendor_id is null and t.vendor_id is not null;
end;
$$;

-- Link one message to a vendor by what is already known. Returns true when linked.
create or replace function public.mail_link_email(p_email uuid)
returns boolean
language plpgsql security definer
set search_path = public
as $$
declare
  e        public.emails%rowtype;
  s        public.email_senders%rowtype;
  v_addrs  text[];
  v_vendor uuid;
  v_how    text;
  v_ids    uuid[];
begin
  select * into e from public.emails where id = p_email;
  if not found or e.vendor_id is not null then return e.vendor_id is not null; end if;
  v_addrs := case when e.direction = 'in' then array[lower(e.from_email)] else (select array_agg(lower(a)) from unnest(e.to_emails || e.cc_emails) a) end;

  -- 1. the thread already belongs to a vendor
  select th.vendor_id into v_vendor from public.email_threads th where th.id = e.thread_id;
  if v_vendor is not null then v_how := 'thread'; end if;

  -- 2. a known contact address of exactly one vendor
  if v_vendor is null then
    select array_agg(distinct ve.vendor_id) into v_ids
      from public.vendor_emails ve join public.vendors v on v.id = ve.vendor_id and v.is_active
     where ve.organization_id = e.organization_id and lower(ve.email) = any (v_addrs);
    if cardinality(v_ids) = 1 then v_vendor := v_ids[1]; v_how := 'sender'; end if;
  end if;

  -- 3. what a person said about this sender
  if v_vendor is null and e.sender_id is not null then
    select * into s from public.email_senders where id = e.sender_id;
    if s.kind = 'vendor' then
      v_vendor := s.vendor_id; v_how := 'sender';
    elsif s.kind = 'rep_group' then
      select array_agg(v.id) into v_ids from public.vendors v
       where v.rep_group_id = s.rep_group_id and v.is_active and v.id = any (e.mentioned_vendor_ids);
      if cardinality(v_ids) = 1 then v_vendor := v_ids[1]; v_how := 'rep_group'; end if;
    end if;
  end if;

  -- 4. same company domain as exactly one vendor's known contact (never free mail, never ours)
  if v_vendor is null then
    select array_agg(distinct ve.vendor_id) into v_ids
      from public.vendor_emails ve join public.vendors v on v.id = ve.vendor_id and v.is_active
     where ve.organization_id = e.organization_id
       and public.mail_domain(ve.email) = any (select public.mail_domain(a) from unnest(v_addrs) a)
       and not public.mail_is_freemail(public.mail_domain(ve.email))
       and not (public.mail_domain(ve.email) = any (coalesce((select internal_domains from public.mail_accounts where organization_id = e.organization_id), '{}')));
    if cardinality(v_ids) = 1 then v_vendor := v_ids[1]; v_how := 'domain'; end if;
  end if;

  if v_vendor is null then return false; end if;
  update public.emails set vendor_id = v_vendor, match_how = v_how where id = p_email;
  return true;
end;
$$;

-- Refresh what VMS proposes for a sender and keep its one review item current.
create or replace function public.mail_refresh_sender(p_sender uuid)
returns void
language plpgsql security definer
set search_path = public
as $$
declare
  s        public.email_senders%rowtype;
  v_count  integer;
  v_best   uuid;
  v_ment   integer;
  v_dom    boolean;
  v_name   text;
  v_note   text;
  v_title  text;
  v_det    jsonb;
  v_item   uuid;
begin
  select * into s from public.email_senders where id = p_sender for update;
  if not found then return; end if;
  select count(*) into v_count from public.emails where sender_id = p_sender;
  update public.email_senders set message_count = v_count, last_seen_at = (select max(received_at) from public.emails where sender_id = p_sender) where id = p_sender;
  if s.kind <> 'unknown' then return; end if;

  -- Score each candidate: one point per email naming it, plus a domain that looks like its name.
  with ments as (
    select unnest(mentioned_vendor_ids) as vid from public.emails where sender_id = p_sender
  ), cand as (
    select vid, count(*)::integer as m from ments group by vid
    union all
    select unnest(s.domain_vendor_ids), 0
  )
  select c.vid, sum(c.m)::integer, bool_or(c.vid = any (s.domain_vendor_ids))
    into v_best, v_ment, v_dom
    from cand c join public.vendors v on v.id = c.vid and v.is_active
   group by c.vid
   order by sum(c.m) + case when bool_or(c.vid = any (s.domain_vendor_ids)) then greatest(2, v_count * 0.5) else 0 end desc, sum(c.m) desc
   limit 1;

  if v_best is not null then
    select name into v_name from public.vendors where id = v_best;
    v_note := concat_ws('; ',
      case when v_ment > 0 then format('named in %s of %s emails', v_ment, v_count) end,
      case when v_dom then 'the web address looks like the name' end);
  end if;
  update public.email_senders set proposed_vendor_id = v_best, proposal_note = v_note where id = p_sender;

  v_title := case when v_best is not null
    then format('Mail from %s%s looks like %s', case when s.is_domain then '@' else '' end, s.sender_key, v_name)
    else format('Mail from %s%s: which vendor?', case when s.is_domain then '@' else '' end, s.sender_key) end;
  v_det := jsonb_build_object(
    'sender_id', s.id, 'sender_key', s.sender_key, 'is_domain', s.is_domain, 'display_name', s.display_name,
    'message_count', v_count, 'proposed_vendor_id', v_best, 'proposed_vendor_name', v_name, 'proposal_note', v_note,
    'vendor_id', v_best,  -- lets the assignment rules route it (fishing vendors to Jarrett)
    'samples', (select coalesce(jsonb_agg(x.subject), '[]'::jsonb) from (select subject from public.emails where sender_id = p_sender and subject is not null order by received_at desc limit 3) x)
  );

  select id into v_item from public.review_items where id = s.review_item_id and status = 'pending';
  if v_item is null then
    insert into public.review_items (organization_id, kind, entity_type, entity_id, title, details)
    values (s.organization_id, 'email_sender', 'email_sender', s.id, v_title, v_det) returning id into v_item;
    update public.email_senders set review_item_id = v_item where id = p_sender;
  else
    update public.review_items set title = v_title, details = v_det where id = v_item;
  end if;
end;
$$;

-- After the sync stores a batch: link what is known, refresh threads and sender proposals. Service role only.
create or replace function public.mail_process(p_org uuid, p_email_ids uuid[], p_backfill boolean default false)
returns jsonb
language plpgsql security definer
set search_path = public
as $$
declare
  r        record;
  v_linked integer := 0;
begin
  for r in select id from public.emails where organization_id = p_org and id = any (p_email_ids) order by received_at loop
    if public.mail_link_email(r.id) then v_linked := v_linked + 1; end if;
  end loop;
  for r in select distinct thread_id from public.emails where id = any (p_email_ids) loop
    perform public.mail_refresh_thread(r.thread_id, p_backfill);
  end loop;
  for r in select distinct e.sender_id from public.emails e join public.email_senders s on s.id = e.sender_id
            where e.id = any (p_email_ids) and s.kind = 'unknown' loop
    perform public.mail_refresh_sender(r.sender_id);
  end loop;
  return jsonb_build_object('linked', v_linked);
end;
$$;

-- A person answers a sender proposal: it is this vendor, this rep group (match each email by what it
-- names), not a vendor, or ours. Links that sender's mail and closes its review item.
create or replace function public.resolve_email_sender(p_sender uuid, p_kind text, p_vendor uuid default null, p_rep_group uuid default null)
returns integer
language plpgsql security definer
set search_path = public
as $$
declare
  s        public.email_senders%rowtype;
  r        record;
  v_linked integer := 0;
begin
  if not public.user_can_edit() then raise exception 'Only admins, managers and buyers decide senders'; end if;
  select * into s from public.email_senders where id = p_sender for update;
  if not found or not public.user_in_org(s.organization_id) then raise exception 'Sender not found'; end if;
  if p_kind not in ('vendor', 'rep_group', 'not_vendor', 'internal') then raise exception 'Unknown answer %', p_kind; end if;
  if p_kind = 'vendor' and not exists (select 1 from public.vendors where id = p_vendor and organization_id = s.organization_id) then raise exception 'Pick a vendor'; end if;
  if p_kind = 'rep_group' and not exists (select 1 from public.rep_groups where id = p_rep_group and organization_id = s.organization_id) then raise exception 'Pick a rep group'; end if;

  update public.email_senders set kind = p_kind,
    vendor_id = case when p_kind = 'vendor' then p_vendor end,
    rep_group_id = case when p_kind = 'rep_group' then p_rep_group end,
    decided_by = auth.uid(), decided_at = now()
  where id = p_sender;
  update public.review_items set status = case when p_kind in ('vendor', 'rep_group') then 'accepted'::public.review_status else 'rejected'::public.review_status end,
         resolved_by = auth.uid(), resolved_at = now(),
         resolution_note = case p_kind when 'vendor' then 'Vendor: ' || (select name from public.vendors where id = p_vendor)
                                       when 'rep_group' then 'Rep group: ' || (select name from public.rep_groups where id = p_rep_group)
                                       when 'not_vendor' then 'Not a vendor' else 'Ours' end
   where id = s.review_item_id and status = 'pending';

  if p_kind in ('vendor', 'rep_group') then
    for r in select id, thread_id from public.emails where sender_id = p_sender and vendor_id is null loop
      if public.mail_link_email(r.id) then v_linked := v_linked + 1; end if;
      perform public.mail_refresh_thread(r.thread_id, false);
    end loop;
  end if;
  return v_linked;
end;
$$;

-- Put one message (and its thread) on a vendor by hand: the Mail page's "Pick vendor".
create or replace function public.set_email_vendor(p_email uuid, p_vendor uuid)
returns void
language plpgsql security definer
set search_path = public
as $$
declare e public.emails%rowtype;
begin
  if not public.user_can_edit() then raise exception 'Only admins, managers and buyers file mail'; end if;
  select * into e from public.emails where id = p_email;
  if not found or not public.user_in_org(e.organization_id) then raise exception 'Email not found'; end if;
  if p_vendor is not null and not exists (select 1 from public.vendors where id = p_vendor and organization_id = e.organization_id) then raise exception 'Vendor not found'; end if;
  update public.emails set vendor_id = p_vendor, match_how = case when p_vendor is null then null else 'manual' end where thread_id = e.thread_id;
  update public.email_threads set vendor_id = p_vendor where id = e.thread_id;
  perform public.mail_refresh_thread(e.thread_id, false);
end;
$$;

-- Hand a thread to someone (or nobody); the rest of the thread follows the new owner.
create or replace function public.assign_email_thread(p_thread uuid, p_profile uuid default null)
returns void
language plpgsql security definer
set search_path = public
as $$
declare t public.email_threads%rowtype;
begin
  if not public.user_can_edit() then raise exception 'Only admins, managers and buyers assign mail'; end if;
  select * into t from public.email_threads where id = p_thread for update;
  if not found or not public.user_in_org(t.organization_id) then raise exception 'Thread not found'; end if;
  if p_profile is not null and not exists (select 1 from public.profiles p where p.id = p_profile and p.organization_id = t.organization_id and p.is_active) then
    raise exception 'That person is not an active user here';
  end if;
  update public.email_threads set owner_id = p_profile, owner_set_at = now() where id = p_thread;
end;
$$;

-- Mark handled, or open again.
create or replace function public.set_email_thread_status(p_thread uuid, p_status text)
returns void
language plpgsql security definer
set search_path = public
as $$
declare t public.email_threads%rowtype;
begin
  if not public.user_can_edit() then raise exception 'Only admins, managers and buyers change mail status'; end if;
  select * into t from public.email_threads where id = p_thread for update;
  if not found or not public.user_in_org(t.organization_id) then raise exception 'Thread not found'; end if;
  if p_status not in ('waiting_on_us', 'waiting_on_vendor', 'handled') then raise exception 'Unknown status %', p_status; end if;
  update public.email_threads set status = p_status, status_msg_at = coalesce(last_message_at, now()),
    follow_up_at = case when p_status = 'handled' then null else follow_up_at end where id = p_thread;
end;
$$;

-- ---- Row Level Security: mail is shared with every member; changes go through the functions above ----
alter table public.mail_accounts     enable row level security;
alter table public.email_senders     enable row level security;
alter table public.email_threads     enable row level security;
alter table public.emails            enable row level security;
alter table public.email_attachments enable row level security;
alter table public.needs             enable row level security;

drop policy if exists "mail_accounts: members read" on public.mail_accounts;
drop policy if exists "mail_accounts: admins update" on public.mail_accounts;
create policy "mail_accounts: members read" on public.mail_accounts for select to authenticated using (public.user_in_org(organization_id));
create policy "mail_accounts: admins update" on public.mail_accounts for update to authenticated
  using (public.is_admin() and public.user_in_org(organization_id)) with check (public.is_admin() and public.user_in_org(organization_id));

drop policy if exists "email_senders: members read" on public.email_senders;
create policy "email_senders: members read" on public.email_senders for select to authenticated using (public.user_in_org(organization_id));
drop policy if exists "email_threads: members read" on public.email_threads;
create policy "email_threads: members read" on public.email_threads for select to authenticated using (public.user_in_org(organization_id));
drop policy if exists "emails: members read" on public.emails;
create policy "emails: members read" on public.emails for select to authenticated using (public.user_in_org(organization_id));
drop policy if exists "email_attachments: members read" on public.email_attachments;
create policy "email_attachments: members read" on public.email_attachments for select to authenticated using (public.user_in_org(organization_id));

drop policy if exists "needs: members read" on public.needs;
drop policy if exists "needs: members add" on public.needs;
drop policy if exists "needs: editors write" on public.needs;
drop policy if exists "needs: editors delete" on public.needs;
create policy "needs: members read" on public.needs for select to authenticated using (public.user_in_org(organization_id));
create policy "needs: members add" on public.needs for insert to authenticated with check (public.user_in_org(organization_id));
create policy "needs: editors write" on public.needs for update to authenticated
  using (public.user_can_edit() and public.user_in_org(organization_id)) with check (public.user_can_edit() and public.user_in_org(organization_id));
create policy "needs: editors delete" on public.needs for delete to authenticated using (public.user_can_edit() and public.user_in_org(organization_id));

grant select on table public.mail_accounts, public.email_senders, public.email_threads, public.emails, public.email_attachments to authenticated;
grant update (follow_up_days) on table public.mail_accounts to authenticated;
grant select, insert, update, delete on table public.needs to authenticated;
grant all on table public.mail_accounts, public.email_senders, public.email_threads, public.emails, public.email_attachments, public.needs to service_role;

revoke execute on function public.mail_default_owner(uuid), public.mail_refresh_thread(uuid, boolean), public.mail_link_email(uuid),
  public.mail_refresh_sender(uuid), public.mail_process(uuid, uuid[], boolean) from public, anon, authenticated;
grant execute on function public.mail_default_owner(uuid), public.mail_refresh_thread(uuid, boolean), public.mail_link_email(uuid),
  public.mail_refresh_sender(uuid), public.mail_process(uuid, uuid[], boolean) to service_role;
grant execute on function public.mail_is_freemail(text), public.mail_domain(text) to authenticated, service_role;
revoke execute on function public.resolve_email_sender(uuid, text, uuid, uuid), public.set_email_vendor(uuid, uuid),
  public.assign_email_thread(uuid, uuid), public.set_email_thread_status(uuid, text) from public, anon;
grant execute on function public.resolve_email_sender(uuid, text, uuid, uuid), public.set_email_vendor(uuid, uuid),
  public.assign_email_thread(uuid, uuid), public.set_email_thread_status(uuid, text) to authenticated, service_role;

-- The SLSI mailbox: orders@, our own domain never a vendor, history back 12 months from today.
insert into public.mail_accounts (organization_id, mailbox, internal_domains, backfill_after)
select o.id, 'orders@shaverlakesports.com', array['shaverlakesports.com'], (current_date - interval '12 months')::date
from public.organizations o where o.id = '00000000-0000-0000-0000-000000000001'
on conflict (organization_id) do nothing;

-- Scheduling (pg_cron calling gmail-sync) is set up by scripts/setup-mail-cron.mjs on the hosted project:
-- it needs a secret that lives in Vault, not in a migration.
