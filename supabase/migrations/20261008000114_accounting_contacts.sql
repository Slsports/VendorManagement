-- 0114 — Accounting step 2 (Dana, Oct 16; docs/accounting-plan.md §3, §4b): the people and companies Dana deals with in
-- billing@ (one light card each) and which conversation belongs to whom. Contacts are proposed from the mail (one per
-- company domain, or per address for Gmail-type senders), Dana confirms, merges or ignores them; a contact's category
-- (taxes, insurance, banking, …) is how the mail and, later, the filing are sorted. Everything here is seen only with
-- the Accounting tick (sees_accounting()).

create table if not exists public.accounting_contacts (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations(id) on delete cascade,
  company          text not null default '',
  person           text not null default '',
  role             text not null default '',
  category         text not null default 'other'
                   check (category in ('taxes', 'insurance', 'banking', 'payroll', 'donations', 'contracts', 'accounting_firm', 'bills', 'other')),
  phones           text[] not null default '{}',
  notes            text not null default '',
  status           text not null default 'proposed' check (status in ('proposed', 'confirmed', 'ignored')),
  message_count    integer not null default 0,
  last_contact_at  timestamptz,
  merged_into      uuid references public.accounting_contacts(id) on delete set null,
  created_by       uuid references public.profiles(id) on delete set null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
comment on table public.accounting_contacts is 'Accounting contacts (Dana, Oct 16): who she deals with in billing@. Proposed from the mail, confirmed by her. Private to the Accounting tick.';
create index if not exists accounting_contacts_org_status_idx on public.accounting_contacts (organization_id, status);
drop trigger if exists accounting_contacts_updated_at on public.accounting_contacts;
create trigger accounting_contacts_updated_at before update on public.accounting_contacts for each row execute function public.set_updated_at();

-- An address (lower-case email) or a whole company domain that belongs to a contact.
create table if not exists public.accounting_contact_addresses (
  organization_id  uuid not null references public.organizations(id) on delete cascade,
  address          text not null,
  is_domain        boolean not null default false,
  contact_id       uuid not null references public.accounting_contacts(id) on delete cascade,
  created_at       timestamptz not null default now(),
  primary key (organization_id, address)
);
create index if not exists accounting_contact_addresses_contact_idx on public.accounting_contact_addresses (contact_id);

alter table public.email_threads add column if not exists accounting_contact_id uuid references public.accounting_contacts(id) on delete set null;
create index if not exists email_threads_accounting_contact_idx on public.email_threads (accounting_contact_id) where accounting_contact_id is not null;

alter table public.accounting_contacts enable row level security;
alter table public.accounting_contact_addresses enable row level security;
drop policy if exists "accounting_contacts: accounting people" on public.accounting_contacts;
create policy "accounting_contacts: accounting people" on public.accounting_contacts for all to authenticated
  using (public.user_in_org(organization_id) and public.sees_accounting())
  with check (public.user_in_org(organization_id) and public.sees_accounting());
drop policy if exists "accounting_contact_addresses: accounting people" on public.accounting_contact_addresses;
create policy "accounting_contact_addresses: accounting people" on public.accounting_contact_addresses for all to authenticated
  using (public.user_in_org(organization_id) and public.sees_accounting())
  with check (public.user_in_org(organization_id) and public.sees_accounting());
grant select, insert, update, delete on table public.accounting_contacts, public.accounting_contact_addresses to authenticated;
grant all on table public.accounting_contacts, public.accounting_contact_addresses to service_role;

-- Our own addresses never become contacts: our domains (mail_accounts.internal_domains) and organizations.own_addresses.
create or replace function public.accounting_our_address(p_org uuid, p_email text) returns boolean
language sql stable security definer set search_path = public as $$
  select p_email is null
      or exists (select 1 from public.mail_accounts a where a.organization_id = p_org and split_part(lower(p_email), '@', 2) = any (a.internal_domains))
      or exists (select 1 from public.organizations o where o.id = p_org and lower(p_email) = any (select lower(x) from unnest(o.own_addresses) x))
$$;

create or replace function public.accounting_freemail(p_domain text) returns boolean
language sql immutable as $$
  select p_domain = any (array['gmail.com','googlemail.com','yahoo.com','ymail.com','outlook.com','hotmail.com','live.com','msn.com','icloud.com','me.com','mac.com','aol.com','comcast.net','att.net','sbcglobal.net','verizon.net','protonmail.com','proton.me'])
$$;

-- Which contact an address belongs to: the exact address first, then the company domain. Ignored and merged ones never.
create or replace function public.accounting_contact_for(p_org uuid, p_email text) returns uuid
language sql stable security definer set search_path = public as $$
  select coalesce(
    (select a.contact_id from public.accounting_contact_addresses a join public.accounting_contacts c on c.id = a.contact_id
      where a.organization_id = p_org and not a.is_domain and a.address = lower(p_email) and c.status <> 'ignored' and c.merged_into is null limit 1),
    (select a.contact_id from public.accounting_contact_addresses a join public.accounting_contacts c on c.id = a.contact_id
      where a.organization_id = p_org and a.is_domain and a.address = split_part(lower(p_email), '@', 2) and c.status <> 'ignored' and c.merged_into is null limit 1))
$$;

-- The other side of a conversation: who wrote to us, or whom we wrote to, newest first.
create or replace function public.accounting_thread_counterpart(p_thread uuid) returns text
language sql stable security definer set search_path = public as $$
  select x.addr from (
    select e.received_at, case when e.direction = 'in' then lower(e.from_email) else lower(t) end as addr
      from public.emails e left join lateral unnest(case when e.direction = 'in' then array[e.from_email] else e.to_emails end) t on true
     where e.thread_id = p_thread and e.copy_of is null
  ) x
  join public.email_threads th on th.id = p_thread
  where x.addr is not null and not public.accounting_our_address(th.organization_id, x.addr)
  order by x.received_at desc limit 1
$$;

create or replace function public.accounting_match_thread(p_thread uuid) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_org uuid; v_contact uuid;
begin
  select organization_id into v_org from public.email_threads where id = p_thread;
  v_contact := public.accounting_contact_for(v_org, public.accounting_thread_counterpart(p_thread));
  update public.email_threads set accounting_contact_id = v_contact where id = p_thread and accounting_contact_id is distinct from v_contact;
  return v_contact;
end;
$$;

-- New mail in the accounting mailbox finds its contact as it arrives.
create or replace function public.emails_accounting_match() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.mailbox_id is not null and new.thread_id is not null
     and exists (select 1 from public.mailboxes m where m.id = new.mailbox_id and m.kind = 'accounting') then
    perform public.accounting_match_thread(new.thread_id);
  end if;
  return new;
end;
$$;
drop trigger if exists emails_accounting_match on public.emails;
create trigger emails_accounting_match after insert on public.emails for each row execute function public.emails_accounting_match();

-- Back-check (CLAUDE.md, Oct 14): every accounting conversation matched again. Returns how many have a contact.
create or replace function public.accounting_rematch_all(p_org uuid) returns integer
language plpgsql security definer set search_path = public as $$
declare n integer := 0; r record;
begin
  if auth.uid() is not null and not public.sees_accounting() then raise exception 'Accounting only' using errcode = '42501'; end if;
  for r in select t.id from public.email_threads t join public.mailboxes m on m.id = t.mailbox_id where t.organization_id = p_org and m.kind = 'accounting' loop
    if public.accounting_match_thread(r.id) is not null then n := n + 1; end if;
  end loop;
  return n;
end;
$$;

-- Propose contacts from the mail: one per company domain (or per address at Gmail-type providers), for anyone we
-- heard from or wrote to at least twice and whose mail is not all newsletters. Never our own addresses, never a key
-- already on a contact. Company and person are guesses from the names seen; Dana fixes them when she confirms.
create or replace function public.accounting_propose_contacts(p_org uuid) returns integer
language plpgsql security definer set search_path = public as $$
declare n integer := 0; r record; v_id uuid; v_company text; v_person text;
begin
  if auth.uid() is not null and not public.sees_accounting() then raise exception 'Accounting only' using errcode = '42501'; end if;
  for r in
    with mail as (
      select lower(e.from_email) as email, nullif(trim(e.from_name), '') as name, e.received_at, coalesce(e.is_bulk, false) as is_bulk
        from public.emails e join public.mailboxes m on m.id = e.mailbox_id and m.kind = 'accounting'
       where e.organization_id = p_org and e.direction = 'in' and e.from_email is not null and e.copy_of is null
      union all
      select lower(t), null, e.received_at, false
        from public.emails e join public.mailboxes m on m.id = e.mailbox_id and m.kind = 'accounting'
        cross join lateral unnest(e.to_emails) t
       where e.organization_id = p_org and e.direction = 'out' and e.copy_of is null
    ), keyed as (
      select case when public.accounting_freemail(split_part(email, '@', 2)) then email else split_part(email, '@', 2) end as key,
             not public.accounting_freemail(split_part(email, '@', 2)) as is_domain, email, name, received_at, is_bulk
        from mail
       where email like '%@%' and not public.accounting_our_address(p_org, email)
         and split_part(email, '@', 1) not in ('mailer-daemon', 'postmaster')
    )
    select key, bool_or(is_domain) as is_domain, count(*) as n, max(received_at) as last_at, bool_and(is_bulk) as all_bulk,
           array_agg(distinct email) as emails,
           mode() within group (order by name) filter (where name ~ '^[A-Z][a-z''-]+( [A-Z]\.?)? [A-Z][A-Za-z''-]+$') as person_name,
           mode() within group (order by name) filter (where name !~ '^[A-Z][a-z''-]+( [A-Z]\.?)? [A-Z][A-Za-z''-]+$' and name !~* '@|noreply|no-reply|do not reply|notification') as company_name
      from keyed
     group by key
    having count(*) >= 2 and not bool_and(is_bulk)
       and not exists (select 1 from public.accounting_contact_addresses a where a.organization_id = p_org and a.address = keyed.key)
  loop
    v_company := coalesce(r.company_name, case when r.is_domain then initcap(replace(split_part(r.key, '.', 1), '-', ' ')) else '' end);
    v_person := coalesce(r.person_name, '');
    insert into public.accounting_contacts (organization_id, company, person, message_count, last_contact_at)
      values (p_org, v_company, v_person, r.n, r.last_at) returning id into v_id;
    insert into public.accounting_contact_addresses (organization_id, address, is_domain, contact_id) values (p_org, r.key, r.is_domain, v_id) on conflict do nothing;
    if r.is_domain then
      insert into public.accounting_contact_addresses (organization_id, address, is_domain, contact_id)
        select p_org, x, false, v_id from unnest(r.emails) x on conflict do nothing;
    end if;
    n := n + 1;
  end loop;
  if n > 0 then perform public.accounting_rematch_all(p_org); end if;
  return n;
end;
$$;

-- Merge one contact into another: addresses, counts and conversations move; the old card is kept as merged.
create or replace function public.accounting_merge_contacts(p_from uuid, p_into uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v_org uuid;
begin
  if not public.sees_accounting() then raise exception 'Accounting only' using errcode = '42501'; end if;
  select organization_id into v_org from public.accounting_contacts where id = p_into;
  if v_org is null or p_from = p_into or not exists (select 1 from public.accounting_contacts where id = p_from and organization_id = v_org) then
    raise exception 'Contact not found' using errcode = '23503';
  end if;
  update public.accounting_contact_addresses set contact_id = p_into where contact_id = p_from;
  update public.accounting_contacts c set message_count = c.message_count + f.message_count, last_contact_at = greatest(c.last_contact_at, f.last_contact_at),
         notes = case when f.notes <> '' then concat_ws(E'\n', nullif(c.notes, ''), f.notes) else c.notes end
    from public.accounting_contacts f where c.id = p_into and f.id = p_from;
  update public.accounting_contacts set status = 'ignored', merged_into = p_into where id = p_from;
  update public.email_threads set accounting_contact_id = p_into where accounting_contact_id = p_from;
end;
$$;

-- Put a conversation on a contact by hand (or take it off with null).
create or replace function public.accounting_set_thread_contact(p_thread uuid, p_contact uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.sees_accounting() then raise exception 'Accounting only' using errcode = '42501'; end if;
  update public.email_threads t set accounting_contact_id = p_contact
   where t.id = p_thread and exists (select 1 from public.mailboxes m where m.id = t.mailbox_id and m.kind = 'accounting');
end;
$$;

-- Recount after a confirm/edit of addresses: messages and last contact per contact.
create or replace function public.accounting_recount(p_org uuid) returns void
language sql security definer set search_path = public as $$
  update public.accounting_contacts c set
    message_count = coalesce((select sum(t.message_count) from public.email_threads t where t.accounting_contact_id = c.id and t.deleted_at is null), 0),
    last_contact_at = (select max(t.last_message_at) from public.email_threads t where t.accounting_contact_id = c.id and t.deleted_at is null)
  where c.organization_id = p_org and c.merged_into is null
$$;

revoke execute on function public.accounting_our_address(uuid, text), public.accounting_contact_for(uuid, text), public.accounting_thread_counterpart(uuid),
  public.accounting_match_thread(uuid), public.accounting_rematch_all(uuid), public.accounting_propose_contacts(uuid),
  public.accounting_merge_contacts(uuid, uuid), public.accounting_set_thread_contact(uuid, uuid), public.accounting_recount(uuid) from public, anon;
grant execute on function public.accounting_rematch_all(uuid), public.accounting_propose_contacts(uuid), public.accounting_merge_contacts(uuid, uuid),
  public.accounting_set_thread_contact(uuid, uuid), public.accounting_recount(uuid) to authenticated;
grant execute on function public.accounting_our_address(uuid, text), public.accounting_contact_for(uuid, text), public.accounting_thread_counterpart(uuid),
  public.accounting_match_thread(uuid), public.accounting_rematch_all(uuid), public.accounting_propose_contacts(uuid),
  public.accounting_merge_contacts(uuid, uuid), public.accounting_set_thread_contact(uuid, uuid), public.accounting_recount(uuid) to service_role;
