-- 0113 — Contacts learned from email (Dana, Oct 13): "Why didn't vms tag any of the contact info to our reps & contacts for
-- WFS? There are plenty of emails there to learn from." … "Contacts go straight onto the vendor with the note it came from
-- email." The contacts-learn function reads Orders mail (12 months back, then as it arrives; never private mail): everyone
-- at a vendor or rep group who writes to us, or whom we write to, becomes a contact (name, title, phones, kinds) from their
-- signature. Existing contacts only get what they are missing (another phone, a title); nothing typed is changed, the
-- starred rep stays. Each address is read once, so a contact someone deleted does not come back.

create table if not exists public.contact_learning (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  email           text not null check (email = lower(email)),
  vendor_id       uuid references public.vendors(id) on delete cascade,
  rep_group_id    uuid references public.rep_groups(id) on delete cascade,
  result          text not null check (result in ('added', 'updated', 'same', 'skipped', 'failed')),
  note            text,
  created_at      timestamptz not null default now(),
  check ((vendor_id is null) <> (rep_group_id is null))
);
comment on table public.contact_learning is 'Addresses Claude has read for contacts (one row per address and vendor or rep group), so none is read twice and deleted contacts stay deleted.';
create unique index if not exists contact_learning_key on public.contact_learning (organization_id, email, coalesce(vendor_id, rep_group_id));
alter table public.contact_learning enable row level security;
drop policy if exists "contact_learning: members read" on public.contact_learning;
create policy "contact_learning: members read" on public.contact_learning for select to authenticated using (public.user_in_org(organization_id));
grant select on table public.contact_learning to authenticated;
grant all on table public.contact_learning to service_role;

-- Addresses to read: people at a vendor or rep group in Orders mail (or a shared conversation) from the last 12 months,
-- with up to three of their emails (theirs first, else ours to them). Service role only.
create or replace function public.contact_learn_queue(p_org uuid, p_limit integer default 8)
returns table (email text, vendor_id uuid, rep_group_id uuid, owner_name text, emails jsonb)
language sql stable security definer set search_path = public as $$
  with ours as (
    select lower(split_part(m.mailbox, '@', 2)) as d from public.mail_accounts m where m.organization_id = p_org
    union select lower(x) from public.mail_accounts m cross join lateral unnest(m.internal_domains) x where m.organization_id = p_org
  ), mail as (
    select e.* from public.emails e
     where e.organization_id = p_org and e.copy_of is null
       and e.received_at > now() - interval '365 days'
       and (e.mailbox_id is null or exists (select 1 from public.email_threads t where t.id = e.thread_id and t.shared_at is not null))
  ), people as (
    -- they wrote to us: the sender record says whose they are
    select lower(m.from_email) as addr, s.vendor_id, s.rep_group_id
      from mail m join public.email_senders s on s.id = m.sender_id
     where m.direction = 'in' and m.from_email like '%@%'
       and ((s.kind = 'vendor' and s.vendor_id = m.vendor_id) or (s.kind = 'rep_group' and s.rep_group_id is not null))
    union
    -- we wrote to them at the vendor's own domain (or their own address on file as the vendor's)
    select lower(a), s.vendor_id, null::uuid
      from mail m cross join lateral unnest(m.to_emails || m.cc_emails) a
      join public.email_senders s on s.organization_id = p_org and s.kind = 'vendor' and s.vendor_id = m.vendor_id
       and (s.sender_key = lower(a) or (s.is_domain and s.sender_key = lower(split_part(a, '@', 2))))
     where m.direction = 'out'
  ), todo as (
    select distinct p.addr, case when p.rep_group_id is null then p.vendor_id end as vendor_id, p.rep_group_id
      from people p
     where p.addr ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'
       and split_part(p.addr, '@', 2) not in (select d from ours)
       and not exists (select 1 from public.contact_learning l where l.organization_id = p_org and l.email = p.addr
                         and coalesce(l.vendor_id, l.rep_group_id) = coalesce(case when p.rep_group_id is null then p.vendor_id end, p.rep_group_id))
     limit p_limit
  )
  select t.addr, t.vendor_id, t.rep_group_id,
         coalesce((select v.name from public.vendors v where v.id = t.vendor_id), (select g.name from public.rep_groups g where g.id = t.rep_group_id)),
         (select coalesce(jsonb_agg(x order by x.theirs desc, x.at desc), '[]'::jsonb) from (
            select m.direction = 'in' as theirs, m.received_at as at, m.subject, m.from_name, m.direction, left(coalesce(m.body_text, m.snippet, ''), 4000) as text
              from mail m
             where (m.direction = 'in' and lower(m.from_email) = t.addr) or (m.direction = 'out' and t.addr = any (select lower(z) from unnest(m.to_emails || m.cc_emails) z))
             order by (m.direction = 'in') desc, m.received_at desc
             limit 3) x)
    from todo t
$$;
revoke execute on function public.contact_learn_queue(uuid, integer) from public, anon, authenticated;
grant execute on function public.contact_learn_queue(uuid, integer) to service_role;
