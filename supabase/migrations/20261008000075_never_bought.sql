-- 0096 — "Who is this?" sorted by Claude, and the "Never bought from" list (Dana, Oct 12).
-- Claude reads each unknown sender once (gmail-sync, a few a minute) and decides:
--   * one of our vendors: the sender is filed to it (sender_filings keeps what it filed so it can be undone from the
--     vendor page);
--   * a company we have never bought from: it becomes Marketing (always Promotions) and joins the Never bought from
--     list on the Review queue, one row per company with its addresses, website and phone from signatures;
--   * unsure: the "Who is this?" card stays.
-- On the list: "This is…" files the company's mail to a vendor and keeps the name as an alias, "Make it a vendor"
-- creates the vendor, "Leave it" marks it checked. Only orders@ mail (and conversations shared to it) is read or
-- counted; personal inboxes stay private.

alter table public.email_senders add column if not exists company_name text;
alter table public.email_senders add column if not exists company_website text;
alter table public.email_senders add column if not exists company_phone text;
alter table public.email_senders add column if not exists sorted_at timestamptz;
alter table public.email_senders add column if not exists sort_note text;
alter table public.email_senders add column if not exists nb_checked_at timestamptz;
alter table public.email_senders add column if not exists nb_checked_by uuid references public.profiles(id) on delete set null;
comment on column public.email_senders.company_name is 'The company behind the sender, as Claude read it from the mail (Never bought from list).';
comment on column public.email_senders.sorted_at is 'When Claude sorted this sender (vendor / never bought from / unsure). Null = not yet.';

create table if not exists public.sender_filings (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations(id) on delete cascade,
  sender_id        uuid not null references public.email_senders(id) on delete cascade,
  vendor_id        uuid not null references public.vendors(id) on delete cascade,
  how              text not null check (how in ('claude', 'this_is')),
  note             text,
  thread_ids       uuid[] not null default '{}',   -- conversations this filing gave a vendor (cleared again on undo)
  created_by       uuid references public.profiles(id) on delete set null,
  created_at       timestamptz not null default now(),
  undone_at        timestamptz,
  undone_by        uuid references public.profiles(id) on delete set null
);
comment on table public.sender_filings is 'A sender filed to a vendor by Claude or from the Never bought from list, with the conversations it filed, so it can be undone.';
create index if not exists sender_filings_vendor_idx on public.sender_filings (vendor_id) where undone_at is null;
alter table public.sender_filings enable row level security;
drop policy if exists "sender_filings: members read" on public.sender_filings;
create policy "sender_filings: members read" on public.sender_filings for select to authenticated using (public.user_in_org(organization_id));
grant select on table public.sender_filings to authenticated;
grant all on table public.sender_filings to service_role;

-- File a sender's mail to a vendor (no permission check: callers check). Returns the filing.
create or replace function public.mail_file_sender(p_sender uuid, p_vendor uuid, p_how text, p_note text, p_user uuid)
returns uuid
language plpgsql security definer
set search_path = public
as $$
declare
  s         public.email_senders%rowtype;
  r         record;
  v_threads uuid[];
  v_id      uuid;
begin
  select * into s from public.email_senders where id = p_sender for update;
  if not found then raise exception 'Sender not found'; end if;
  if not exists (select 1 from public.vendors where id = p_vendor and organization_id = s.organization_id) then raise exception 'Vendor not found'; end if;
  select coalesce(array_agg(distinct t.id), '{}') into v_threads
    from public.emails e join public.email_threads t on t.id = e.thread_id
   where e.sender_id = p_sender and t.vendor_id is null;

  update public.email_senders set kind = 'vendor', vendor_id = p_vendor, rep_group_id = null,
    view_rule = case when kind = 'marketing' then null else view_rule end,
    decided_by = p_user, decided_at = now(), sorted_at = coalesce(sorted_at, now()), nb_checked_at = null, nb_checked_by = null
   where id = p_sender;
  update public.review_items set status = 'accepted', resolved_by = p_user, resolved_at = now(),
         resolution_note = 'Vendor: ' || (select name from public.vendors where id = p_vendor) || case when p_how = 'claude' then ' (Claude)' else '' end
   where id = s.review_item_id and status = 'pending';
  for r in select id, thread_id from public.emails where sender_id = p_sender and vendor_id is null loop
    perform public.mail_link_email(r.id);
    perform public.mail_auto_tag(r.id);
    perform public.mail_refresh_thread(r.thread_id, false);
  end loop;
  perform public.mail_classify(s.organization_id, (select array_agg(id) from public.emails where sender_id = p_sender));
  insert into public.sender_filings (organization_id, sender_id, vendor_id, how, note, thread_ids, created_by)
  values (s.organization_id, p_sender, p_vendor, p_how, left(p_note, 300), v_threads, p_user) returning id into v_id;
  return v_id;
end;
$$;

-- Claude's answer for one sender (gmail-sync, service role). decision: vendor / never_bought / unsure.
create or replace function public.mail_apply_sender_sort(p_sender uuid, p_decision text, p_vendor uuid, p_company text, p_website text, p_phone text, p_note text)
returns text
language plpgsql security definer
set search_path = public
as $$
declare s public.email_senders%rowtype;
begin
  select * into s from public.email_senders where id = p_sender for update;
  if not found then return 'gone'; end if;
  update public.email_senders set company_name = coalesce(nullif(trim(p_company), ''), company_name),
    company_website = coalesce(nullif(trim(p_website), ''), company_website), company_phone = coalesce(nullif(trim(p_phone), ''), company_phone),
    sorted_at = now(), sort_note = left(p_note, 300)
   where id = p_sender;
  if s.kind <> 'unknown' then return 'info'; end if;

  if p_decision = 'vendor' and p_vendor is not null
     and exists (select 1 from public.vendors where id = p_vendor and organization_id = s.organization_id and is_active and merged_into_id is null) then
    perform public.mail_file_sender(p_sender, p_vendor, 'claude', p_note, null);
    return 'filed';
  elsif p_decision = 'never_bought' then
    update public.email_senders set kind = 'marketing', view_rule = 'offers', decided_at = now() where id = p_sender;
    update public.review_items set status = 'rejected', resolved_at = now(), resolution_note = 'Never bought from (Claude)'
     where id = s.review_item_id and status = 'pending';
    perform public.mail_classify(s.organization_id, (select array_agg(id) from public.emails where sender_id = p_sender));
    return 'never_bought';
  end if;
  update public.email_senders set ai_note = coalesce(left(p_note, 300), ai_note), ai_read_at = coalesce(ai_read_at, now()) where id = p_sender;
  return 'unsure';
end;
$$;
revoke execute on function public.mail_file_sender(uuid, uuid, text, text, uuid), public.mail_apply_sender_sort(uuid, text, uuid, text, text, text, text) from public, anon, authenticated;
grant execute on function public.mail_file_sender(uuid, uuid, text, text, uuid), public.mail_apply_sender_sort(uuid, text, uuid, text, text, text, text) to service_role;

-- How many emails orders@ sent to a sender (an address, or anyone at a domain): a sign we already deal with them.
create or replace function public.mail_sent_to_count(p_org uuid, p_key text, p_is_domain boolean)
returns integer language sql stable security definer set search_path = public as $$
  select count(*)::integer from public.emails e
   where e.organization_id = p_org and e.direction = 'out' and e.mailbox_id is null
     and exists (select 1 from unnest(e.to_emails || e.cc_emails) a
                  where case when p_is_domain then lower(a) like '%@' || lower(p_key) else lower(a) = lower(p_key) end)
$$;
revoke execute on function public.mail_sent_to_count(uuid, text, boolean) from public, anon, authenticated;
grant execute on function public.mail_sent_to_count(uuid, text, boolean) to service_role;

-- Undo a filing from the vendor page: its conversations lose the vendor again and the sender goes back to "Who is this?".
create or replace function public.undo_sender_filing(p_filing uuid)
returns void
language plpgsql security definer
set search_path = public
as $$
declare
  f  public.sender_filings%rowtype;
  t  uuid;
begin
  if not public.user_can_edit() then raise exception 'Only admins, managers and buyers file mail'; end if;
  select * into f from public.sender_filings where id = p_filing for update;
  if not found or not public.user_in_org(f.organization_id) then raise exception 'Not found'; end if;
  if f.undone_at is not null then return; end if;
  update public.emails set vendor_id = null, match_how = null
   where vendor_id = f.vendor_id and match_how is distinct from 'manual'
     and (thread_id = any (f.thread_ids) or (sender_id = f.sender_id and match_how = 'sender'));
  update public.email_threads set vendor_id = null where id = any (f.thread_ids) and vendor_id = f.vendor_id;
  foreach t in array f.thread_ids loop perform public.mail_refresh_thread(t, false); end loop;
  update public.email_senders set kind = 'unknown', vendor_id = null, decided_by = null, decided_at = null where id = f.sender_id and vendor_id = f.vendor_id;
  update public.sender_filings set undone_at = now(), undone_by = auth.uid() where id = p_filing;
  perform public.mail_refresh_sender(f.sender_id);
end;
$$;

-- The Never bought from list: one row per company (Claude's company name, else the sender), orders@ mail only.
create or replace function public.list_never_bought(p_org uuid)
returns table (company text, sender_ids uuid[], addresses text[], website text, phone text, email_count bigint, latest_at timestamptz,
               checked_at timestamptz, checked_by text, note text)
language sql stable security definer
set search_path = public
as $$
  with s as (
    select es.*, lower(coalesce(nullif(trim(es.company_name), ''), es.sender_key)) as ckey
      from public.email_senders es
     where es.organization_id = p_org and es.kind = 'marketing' and public.user_in_org(p_org)
  ), e as (
    select e.sender_id, e.received_at, lower(e.from_email) as addr
      from public.emails e join public.email_threads t on t.id = e.thread_id
     where e.organization_id = p_org and e.sender_id in (select id from s) and (e.mailbox_id is null or t.shared_at is not null)
  ), m as (
    select s.ckey, count(*) as n, max(e.received_at) as latest, array_agg(distinct e.addr) filter (where e.addr is not null) as addrs
      from e join s on s.id = e.sender_id group by s.ckey
  )
  select min(coalesce(nullif(trim(s.company_name), ''), s.display_name, s.sender_key)),
         array_agg(s.id), min(m.addrs), max(s.company_website), max(s.company_phone),
         min(m.n)::bigint, min(m.latest), max(s.nb_checked_at),
         (select p.full_name from public.profiles p where p.id = (array_agg(s.nb_checked_by order by s.nb_checked_at desc nulls last))[1]),
         max(s.sort_note)
    from s join m on m.ckey = s.ckey
   group by s.ckey
$$;
revoke execute on function public.list_never_bought(uuid) from public, anon;
grant execute on function public.list_never_bought(uuid) to authenticated, service_role;

-- "This is…": the company is one of our vendors after all. Files its mail there and keeps the name as an alias.
create or replace function public.never_bought_is_vendor(p_senders uuid[], p_vendor uuid)
returns integer
language plpgsql security definer
set search_path = public
as $$
declare
  v_org  uuid;
  v_name text;
  s      uuid;
  n      integer := 0;
begin
  if not public.user_can_edit() then raise exception 'Only admins, managers and buyers file mail'; end if;
  select organization_id into v_org from public.vendors where id = p_vendor;
  if v_org is null or not public.user_in_org(v_org) then raise exception 'Vendor not found'; end if;
  if exists (select 1 from public.email_senders where id = any (p_senders) and (organization_id <> v_org or kind <> 'marketing')) then raise exception 'Not on the Never bought from list'; end if;
  select coalesce(nullif(trim(company_name), ''), display_name) into v_name from public.email_senders where id = any (p_senders) and coalesce(company_name, display_name) is not null limit 1;
  foreach s in array p_senders loop
    perform public.mail_file_sender(s, p_vendor, 'this_is', null, auth.uid());
    n := n + 1;
  end loop;
  update public.vendors set aliases = array_append(aliases, v_name)
   where id = p_vendor and v_name is not null and lower(v_name) <> lower(name)
     and not exists (select 1 from unnest(aliases) a where lower(a) = lower(v_name));
  return n;
end;
$$;

-- "Make it a vendor": creates the vendor from what Claude read, then files the mail there. Returns the vendor.
create or replace function public.never_bought_make_vendor(p_senders uuid[], p_name text, p_website text default null, p_phone text default null)
returns uuid
language plpgsql security definer
set search_path = public
as $$
declare
  v_org uuid;
  v_id  uuid;
begin
  if not public.user_can_edit() then raise exception 'Only admins, managers and buyers add vendors'; end if;
  if nullif(trim(p_name), '') is null then raise exception 'Type the vendor name'; end if;
  select organization_id into v_org from public.email_senders where id = p_senders[1];
  if v_org is null or not public.user_in_org(v_org) then raise exception 'Not found'; end if;
  insert into public.vendors (organization_id, name, website, phone) values (v_org, trim(p_name), nullif(trim(p_website), ''), nullif(trim(p_phone), '')) returning id into v_id;
  perform public.never_bought_is_vendor(p_senders, v_id);
  return v_id;
end;
$$;

-- "Leave it": checked, stays on the list (p_checked false puts it back to check).
create or replace function public.never_bought_leave(p_senders uuid[], p_checked boolean default true)
returns void
language plpgsql security definer
set search_path = public
as $$
begin
  if not public.user_can_edit() then raise exception 'Only admins, managers and buyers check this list'; end if;
  update public.email_senders set nb_checked_at = case when p_checked then now() end, nb_checked_by = case when p_checked then auth.uid() end
   where id = any (p_senders) and kind = 'marketing' and public.user_in_org(organization_id);
end;
$$;
revoke execute on function public.undo_sender_filing(uuid), public.never_bought_is_vendor(uuid[], uuid), public.never_bought_make_vendor(uuid[], text, text, text), public.never_bought_leave(uuid[], boolean) from public, anon;
grant execute on function public.undo_sender_filing(uuid), public.never_bought_is_vendor(uuid[], uuid), public.never_bought_make_vendor(uuid[], text, text, text), public.never_bought_leave(uuid[], boolean) to authenticated, service_role;
