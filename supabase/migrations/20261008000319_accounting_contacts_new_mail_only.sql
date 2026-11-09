-- 0319 — Accounting contacts look only at what changed (Dana, Nov 6: "Why do we need to check all the way back in
-- conversations?? After the first run through it should only be updating new emails, new documents being added, etc.").
-- Confirmed in the logs: the once-a-minute "find new people in billing@" step had failed every minute for at least a day
-- (8-second limit). It read all ~32,000 billing@ emails (3.5 s) and then re-matched all ~22,100 conversations one by one
-- (12 s). The same full re-match ran behind Find new in the mail, ✓ / ✕ on the contacts list and Save on a contact card.
--   • Finding new people reads only the mail added since the last look (10 minutes overlap so nothing slips between runs).
--   • A new, confirmed, ignored or edited contact re-matches only the conversations with its addresses or already on it.
--   • New mail is still matched as it arrives (unchanged). The full re-match stays for back-checks, done all at once (~0.5 s).
-- The first run below catches up on the mail that waited while the step was failing; what it finds waits under To confirm.
set local lock_timeout = '5s';

-- When each company last looked for new people in billing@.
create table if not exists public.accounting_propose_state (
  organization_id uuid primary key references public.organizations(id) on delete cascade,
  checked_to timestamptz not null
);
alter table public.accounting_propose_state enable row level security;
drop policy if exists "accounting_propose_state: accounting reads" on public.accounting_propose_state;
create policy "accounting_propose_state: accounting reads" on public.accounting_propose_state
  for select to authenticated using (public.user_in_org(organization_id) and public.sees_accounting());
grant select on public.accounting_propose_state to authenticated;
grant all on public.accounting_propose_state to service_role;

-- Same conversation, same answer every time: when the newest email went to several people, take them in order.
create or replace function public.accounting_thread_counterpart(p_thread uuid)
returns text language sql stable security definer set search_path = public as $$
  select x.addr from (
    select e.received_at, case when e.direction = 'in' then lower(e.from_email) else lower(t) end as addr
      from public.emails e left join lateral unnest(case when e.direction = 'in' then array[e.from_email] else e.to_emails end) t on true
     where e.thread_id = p_thread and e.copy_of is null
  ) x
  join public.email_threads th on th.id = p_thread
  where x.addr is not null and not public.accounting_our_address(th.organization_id, x.addr)
  order by x.received_at desc, x.addr limit 1
$$;

-- Re-match only the billing@ conversations that can change: any email with one of these addresses or domains
-- (a company domain covers its sub-domains), plus the conversations already on these contacts.
create or replace function public.accounting_rematch_keys(p_org uuid, p_keys text[], p_contacts uuid[] default '{}')
returns integer language plpgsql security definer set search_path = public as $$
declare n integer := 0; r record; v_keys text[]; v_like text[];
begin
  if auth.uid() is not null and not (public.sees_accounting() and public.user_in_org(p_org)) then raise exception 'Accounting only' using errcode = '42501'; end if;
  v_keys := coalesce(array(select distinct lower(trim(k)) from unnest(p_keys) k where coalesce(trim(k), '') <> ''), '{}');
  v_like := coalesce(array(select '%.' || k from unnest(v_keys) k where position('@' in k) = 0), '{}');
  if cardinality(v_keys) = 0 and coalesce(cardinality(p_contacts), 0) = 0 then return 0; end if;
  for r in
    select distinct e.thread_id as id
      from public.emails e join public.mailboxes m on m.id = e.mailbox_id and m.kind = 'accounting'
      cross join lateral unnest(case when e.direction = 'in' then array[e.from_email] else e.to_emails end) x0(a)
     where cardinality(v_keys) > 0 and e.organization_id = p_org and e.copy_of is null and e.thread_id is not null and x0.a is not null
       and (lower(x0.a) = any (v_keys) or split_part(lower(x0.a), '@', 2) = any (v_keys) or split_part(lower(x0.a), '@', 2) like any (v_like))
    union
    select t.id from public.email_threads t where t.organization_id = p_org and t.accounting_contact_id = any (coalesce(p_contacts, '{}'))
  loop
    perform public.accounting_match_thread(r.id);
    n := n + 1;
  end loop;
  return n;
end;
$$;

-- One contact changed (confirmed, ignored, addresses edited): re-match its conversations and anything at its addresses.
create or replace function public.accounting_rematch_contact(p_contact uuid, p_old_addresses text[] default '{}')
returns integer language plpgsql security definer set search_path = public as $$
declare v_org uuid; v_keys text[];
begin
  if not public.sees_accounting() then raise exception 'Accounting only' using errcode = '42501'; end if;
  select organization_id into v_org from public.accounting_contacts where id = p_contact;
  if v_org is null or not public.user_in_org(v_org) then raise exception 'Contact not found' using errcode = '23503'; end if;
  select coalesce(array_agg(address), '{}') into v_keys from public.accounting_contact_addresses where contact_id = p_contact;
  return public.accounting_rematch_keys(v_org, v_keys || coalesce(p_old_addresses, '{}'), array[p_contact]);
end;
$$;

-- The full re-match, for back-checks: every billing@ conversation at once (same answers as one by one).
create or replace function public.accounting_rematch_all(p_org uuid)
returns integer language plpgsql security definer set search_path = public as $$
declare n integer;
begin
  if auth.uid() is not null and not (public.sees_accounting() and public.user_in_org(p_org)) then raise exception 'Accounting only' using errcode = '42501'; end if;
  with own as (
    select coalesce((select array_agg(distinct lower(d)) from public.mail_accounts a, unnest(a.internal_domains) d where a.organization_id = p_org), '{}') as domains,
           coalesce((select array_agg(lower(x)) from public.organizations o, unnest(o.own_addresses) x where o.id = p_org), '{}') as addrs
  ), th as (
    select t.id, t.accounting_contact_id from public.email_threads t join public.mailboxes m on m.id = t.mailbox_id and m.kind = 'accounting'
     where t.organization_id = p_org
  ), cp as (
    select distinct on (e.thread_id) e.thread_id, x.addr
      from th join public.emails e on e.thread_id = th.id
      cross join lateral unnest(case when e.direction = 'in' then array[e.from_email] else e.to_emails end) x0(a)
      cross join lateral (select lower(x0.a) as addr) x, own
     where e.copy_of is null and x.addr is not null
       and not (split_part(x.addr, '@', 2) = any (own.domains) or x.addr = any (own.addrs))
     order by e.thread_id, e.received_at desc, x.addr
  ), ct as (
    select d.addr, public.accounting_contact_for(p_org, d.addr) as contact_id from (select distinct addr from cp) d
  ), want as (
    select th.id, ct.contact_id from th left join cp on cp.thread_id = th.id left join ct on ct.addr = cp.addr
  )
  update public.email_threads t set accounting_contact_id = w.contact_id
    from want w where t.id = w.id and t.accounting_contact_id is distinct from w.contact_id;
  select count(*) into n from public.email_threads t join public.mailboxes m on m.id = t.mailbox_id and m.kind = 'accounting'
   where t.organization_id = p_org and t.accounting_contact_id is not null;
  return n;
end;
$$;

-- Find new people: only addresses in mail added since the last look; each is then counted over all billing@ mail
-- (two emails or more, not only newsletters), as before.
create or replace function public.accounting_propose_contacts(p_org uuid)
returns integer language plpgsql security definer set search_path = public as $$
declare n integer := 0; r record; v_id uuid; v_company text; v_person text;
        v_now timestamptz := now(); v_since timestamptz; v_cand text[]; v_like text[]; v_keys text[] := '{}';
begin
  if auth.uid() is not null and not (public.sees_accounting() and public.user_in_org(p_org)) then raise exception 'Accounting only' using errcode = '42501'; end if;
  select checked_to - interval '10 minutes' into v_since from public.accounting_propose_state where organization_id = p_org;

  -- addresses in the new mail that are not on a contact yet (on the first run: all the mail)
  with addrs as (
    select distinct lower(e.from_email) as email
      from public.emails e join public.mailboxes m on m.id = e.mailbox_id and m.kind = 'accounting'
     where e.organization_id = p_org and e.direction = 'in' and e.from_email is not null and e.copy_of is null and (v_since is null or e.created_at > v_since)
    union
    select distinct lower(t)
      from public.emails e join public.mailboxes m on m.id = e.mailbox_id and m.kind = 'accounting'
      cross join lateral unnest(e.to_emails) t
     where e.organization_id = p_org and e.direction = 'out' and e.copy_of is null and (v_since is null or e.created_at > v_since)
  ), keyed as (
    select case when public.accounting_freemail(split_part(email, '@', 2)) then email else public.accounting_company_domain(email) end as key
      from addrs
     where email like '%@%' and not public.accounting_our_address(p_org, email)
       and split_part(email, '@', 1) not in ('mailer-daemon', 'postmaster')
  )
  select array_agg(distinct key) into v_cand from keyed k
   where key is not null and not exists (select 1 from public.accounting_contact_addresses a where a.organization_id = p_org and a.address = k.key);

  insert into public.accounting_propose_state (organization_id, checked_to) values (p_org, v_now)
    on conflict (organization_id) do update set checked_to = excluded.checked_to;
  if v_cand is null then return 0; end if;
  v_like := coalesce(array(select '%.' || k from unnest(v_cand) k where position('@' in k) = 0), '{}');

  for r in
    with mail as (
      select lower(e.from_email) as email, nullif(trim(e.from_name), '') as name, e.received_at, coalesce(e.is_bulk, false) as is_bulk
        from public.emails e join public.mailboxes m on m.id = e.mailbox_id and m.kind = 'accounting'
       where e.organization_id = p_org and e.direction = 'in' and e.from_email is not null and e.copy_of is null
         and (lower(e.from_email) = any (v_cand) or split_part(lower(e.from_email), '@', 2) = any (v_cand) or split_part(lower(e.from_email), '@', 2) like any (v_like))
      union all
      select lower(t), null, e.received_at, false
        from public.emails e join public.mailboxes m on m.id = e.mailbox_id and m.kind = 'accounting'
        cross join lateral unnest(e.to_emails) t
       where e.organization_id = p_org and e.direction = 'out' and e.copy_of is null
         and (lower(t) = any (v_cand) or split_part(lower(t), '@', 2) = any (v_cand) or split_part(lower(t), '@', 2) like any (v_like))
    ), keyed as (
      select case when public.accounting_freemail(split_part(email, '@', 2)) then email else public.accounting_company_domain(email) end as key,
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
     where key = any (v_cand)
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
    v_keys := v_keys || r.key || r.emails;
    n := n + 1;
  end loop;
  if n > 0 then perform public.accounting_rematch_keys(p_org, v_keys); end if;
  return n;
end;
$$;

revoke execute on function public.accounting_rematch_keys(uuid, text[], uuid[]), public.accounting_rematch_contact(uuid, text[]) from public, anon;
grant execute on function public.accounting_rematch_keys(uuid, text[], uuid[]), public.accounting_rematch_contact(uuid, text[]) to authenticated, service_role;

-- Catch up once on the mail that waited while the step was failing (people found wait under To confirm).
select public.accounting_propose_contacts(o.id) from public.organizations o
 where exists (select 1 from public.mailboxes m where m.organization_id = o.id and m.kind = 'accounting');
