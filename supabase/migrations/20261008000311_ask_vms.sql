-- 0311 — Ask VMS (Dana, Nov 5, 2026): a chat in VMS where the buyers talk through buying questions the way Dana did with
-- Claude on the Smith helmet and goggle orders ("we need to look in the category to see where we overlap"). Claude
-- (claude-opus-5-5) answers from VMS's own data, read only, and runs as the person asking, so private mail stays private.
--   • Who: managers and buyers Dana ticks (profiles.ask_vms; Jarrett now) and Dana. Trevor is not ticked (Dana: "trevor
--     is not a buyer, not sure he would need access to that").
--   • Dana reads every chat ("so I can know if they are asking the right questions ... its good training"); everyone else
--     sees only their own.
--   • $5 a day per person (ask_spent_today); the ask-vms function stops at the limit.
--   • Nobody but Dana changes VMS (Nov 5): a request to change VMS becomes a change request with a task for Dana. When she
--     approves or turns it down, the person who asked gets a task with her answer. Claude builds only what she approves.

set local lock_timeout = '5s';

alter table public.profiles add column if not exists ask_vms boolean not null default false;
comment on column public.profiles.ask_vms is 'Can use Ask VMS (Dana, Nov 5: managers and buyers she picks). Dana always can.';

create table if not exists public.ask_chats (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  owner_id uuid not null references public.profiles(id) on delete cascade,
  title text,
  vendor_id uuid references public.vendors(id) on delete set null,
  order_id uuid references public.orders(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists ask_chats_owner on public.ask_chats (organization_id, owner_id, updated_at desc);
comment on table public.ask_chats is 'Ask VMS conversations (Dana, Nov 5). The owner and the admin read them.';

create table if not exists public.ask_messages (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  chat_id uuid not null references public.ask_chats(id) on delete cascade,
  role text not null check (role in ('user', 'assistant')),
  content text not null default '',
  status text not null default 'done' check (status in ('working', 'done', 'failed')),
  progress text,
  steps jsonb not null default '[]',
  cost_usd numeric(10, 5) not null default 0,
  input_tokens integer not null default 0,
  output_tokens integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists ask_messages_chat on public.ask_messages (chat_id, created_at);
comment on column public.ask_messages.steps is 'What Claude looked up for this answer, in order (tool, input, how many rows), for Dana''s training reads.';

create table if not exists public.change_requests (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  requested_by uuid not null references public.profiles(id) on delete cascade,
  chat_id uuid references public.ask_chats(id) on delete set null,
  title text not null,
  details text not null default '',
  why text,
  status text not null default 'waiting' check (status in ('waiting', 'approved', 'declined', 'built')),
  decision_note text,
  decided_by uuid references public.profiles(id) on delete set null,
  decided_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists change_requests_open on public.change_requests (organization_id, status, created_at desc);
comment on table public.change_requests is 'Requests to change VMS itself. Only Dana approves; Claude builds only what she approves (Dana, Nov 5).';

-- ---- who may ask, and what they spent today ------------------------------------------------------------------------
create or replace function public.can_ask_vms() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select p.is_active and (p.role = 'admin' or p.ask_vms) from public.profiles p where p.id = auth.uid()), false)
$$;
revoke execute on function public.can_ask_vms() from public, anon;
grant execute on function public.can_ask_vms() to authenticated, service_role;

create or replace function public.ask_spent_today(p_user uuid) returns numeric
language sql stable security definer set search_path = public as $$
  select coalesce(sum(m.cost_usd), 0)
    from public.ask_messages m join public.ask_chats c on c.id = m.chat_id
   where c.owner_id = p_user
     and m.created_at >= (date_trunc('day', now() at time zone 'America/Los_Angeles') at time zone 'America/Los_Angeles')
$$;
revoke execute on function public.ask_spent_today(uuid) from public, anon, authenticated;
grant execute on function public.ask_spent_today(uuid) to service_role;

-- what I (or, for the admin, anyone) spent today, for the page
create or replace function public.ask_my_spend() returns numeric
language sql stable security definer set search_path = public as $$
  select public.ask_spent_today(auth.uid())
$$;
revoke execute on function public.ask_my_spend() from public, anon;
grant execute on function public.ask_my_spend() to authenticated;

-- ---- RLS -------------------------------------------------------------------------------------------------------------
alter table public.ask_chats enable row level security;
alter table public.ask_messages enable row level security;
alter table public.change_requests enable row level security;

drop policy if exists "ask_chats: owner or admin read" on public.ask_chats;
create policy "ask_chats: owner or admin read" on public.ask_chats for select to authenticated
  using (public.user_in_org(organization_id) and (owner_id = auth.uid() or public.is_admin()));
drop policy if exists "ask_chats: owner renames" on public.ask_chats;
create policy "ask_chats: owner renames" on public.ask_chats for update to authenticated
  using (public.user_in_org(organization_id) and owner_id = auth.uid()) with check (public.user_in_org(organization_id) and owner_id = auth.uid());
drop policy if exists "ask_chats: owner or admin deletes" on public.ask_chats;
create policy "ask_chats: owner or admin deletes" on public.ask_chats for delete to authenticated
  using (public.user_in_org(organization_id) and (owner_id = auth.uid() or public.is_admin()));

drop policy if exists "ask_messages: chat owner or admin read" on public.ask_messages;
create policy "ask_messages: chat owner or admin read" on public.ask_messages for select to authenticated
  using (public.user_in_org(organization_id) and exists (select 1 from public.ask_chats c where c.id = chat_id and (c.owner_id = auth.uid() or public.is_admin())));

drop policy if exists "change_requests: requester or admin read" on public.change_requests;
create policy "change_requests: requester or admin read" on public.change_requests for select to authenticated
  using (public.user_in_org(organization_id) and (requested_by = auth.uid() or public.is_admin()));

grant select, update, delete on public.ask_chats to authenticated;
grant select on public.ask_messages to authenticated;
grant select on public.change_requests to authenticated;
grant all on public.ask_chats, public.ask_messages, public.change_requests to service_role;

-- ---- change requests: a task for Dana, and her answer back to the person who asked ---------------------------------
create or replace function public.change_requests_task() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_who text;
begin
  select coalesce(full_name, email) into v_who from public.profiles where id = new.requested_by;
  insert into public.tasks (organization_id, title, notes, due_date, remind_at, assigned_to, created_by, auto_key)
  values (new.organization_id, left(format('Change request from %s: %s', coalesce(v_who, 'someone'), new.title), 200),
          concat_ws(E'\n\n', new.details, case when nullif(new.why, '') is not null then 'Why: ' || new.why end,
                    'Open Ask VMS › Change requests to approve it or turn it down. Claude builds it only after you approve it.'),
          current_date, now(), public.org_admin(new.organization_id), new.requested_by, 'changereq:' || new.id)
  on conflict (organization_id, auto_key) where auto_key is not null do nothing;
  return null;
end;
$$;
revoke execute on function public.change_requests_task() from public, anon, authenticated;
drop trigger if exists change_requests_task on public.change_requests;
create trigger change_requests_task after insert on public.change_requests for each row execute function public.change_requests_task();

/** Dana approves or turns down a change request; her task closes and the person who asked gets her answer. */
create or replace function public.change_request_decide(p_id uuid, p_status text, p_note text) returns void
language plpgsql security definer set search_path = public as $$
declare r public.change_requests%rowtype;
begin
  if not public.is_admin() then raise exception 'Only Dana decides change requests' using errcode = '42501'; end if;
  if p_status not in ('approved', 'declined', 'built') then raise exception 'Approve, turn down or mark built' using errcode = '22023'; end if;
  select * into r from public.change_requests where id = p_id and public.user_in_org(organization_id);
  if r.id is null then raise exception 'Change request not found' using errcode = '23503'; end if;
  update public.change_requests set status = p_status, decision_note = nullif(trim(coalesce(p_note, '')), ''), decided_by = auth.uid(), decided_at = now()
   where id = p_id;
  update public.tasks set done_at = coalesce(done_at, now()), done_by = coalesce(done_by, auth.uid()),
         done_note = coalesce(done_note, case p_status when 'declined' then 'Turned down' when 'built' then 'Built' else 'Approved' end || coalesce(': ' || nullif(trim(p_note), ''), ''))
   where organization_id = r.organization_id and auto_key = 'changereq:' || r.id and done_at is null;
  if r.requested_by <> auth.uid() and p_status in ('approved', 'declined') then
    insert into public.tasks (organization_id, title, notes, due_date, assigned_to, created_by, auto_key)
    values (r.organization_id,
            left(format('Your change request was %s: %s', case p_status when 'declined' then 'turned down' else 'approved' end, r.title), 200),
            coalesce(nullif(trim(p_note), ''), case p_status when 'declined' then 'Dana turned this down.' else 'Dana approved this. It will be built.' end),
            current_date, r.requested_by, auth.uid(), 'changeans:' || r.id || ':' || p_status)
    on conflict (organization_id, auto_key) where auto_key is not null do nothing;
  end if;
end;
$$;
revoke execute on function public.change_request_decide(uuid, text, text) from public, anon;
grant execute on function public.change_request_decide(uuid, text, text) to authenticated;

-- Jarrett asks; Trevor does not (Dana, Nov 5)
update public.profiles set ask_vms = true where lower(email) = 'jarrett@shaverlakesports.com';
