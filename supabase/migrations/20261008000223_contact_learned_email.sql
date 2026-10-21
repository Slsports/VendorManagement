-- 0223 — "Learned from email" opens the exact email (Dana, Oct 21). A contact Claude learned from an email signature
-- linked to all mail with that address; now it keeps the email it was learned from and opens that one.
--   1. learned_email_id on vendor_emails and rep_group_contacts (the two tables contacts-learn and sent-orders write).
--      Older contacts keep it empty: contact_learning never recorded which email was read, so nothing is back-filled by
--      guessing; the screen keeps opening all mail with them for those.
--   2. contact_learn_queue hands each email's id with its text, so contacts-learn can say which one the details came from.
--   3. vendor_contact_to_rep_group carries the email along when a learned card moves onto the rep group.

alter table public.vendor_emails add column if not exists learned_email_id uuid references public.emails(id) on delete set null;
alter table public.rep_group_contacts add column if not exists learned_email_id uuid references public.emails(id) on delete set null;
comment on column public.vendor_emails.learned_email_id is 'The email this contact (or the details filled into it) was learned from by Claude; "Learned from email" opens it. Null for typed contacts and those learned before Oct 21, 2026.';
comment on column public.rep_group_contacts.learned_email_id is 'The email this rep group person (or the details filled into it) was learned from by Claude. Null for typed people and those learned before Oct 21, 2026.';
-- deleting an email clears the link quickly
create index if not exists vendor_emails_learned_email_idx on public.vendor_emails (learned_email_id) where learned_email_id is not null;
create index if not exists rep_group_contacts_learned_email_idx on public.rep_group_contacts (learned_email_id) where learned_email_id is not null;

-- grants are on the whole table (the new column is covered); restated so this migration stands on its own. RLS policies
-- on both tables are unchanged: the column is read and written with the row.
grant select, insert, update, delete on table public.vendor_emails, public.rep_group_contacts to authenticated;
grant all on table public.vendor_emails, public.rep_group_contacts to service_role;

-- 2. as in 0113 (20261008000092), each email now carries its id
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
            select m.id, m.direction = 'in' as theirs, m.received_at as at, m.subject, m.from_name, m.direction, left(coalesce(m.body_text, m.snippet, ''), 4000) as text
              from mail m
             where (m.direction = 'in' and lower(m.from_email) = t.addr) or (m.direction = 'out' and t.addr = any (select lower(z) from unnest(m.to_emails || m.cc_emails) z))
             order by (m.direction = 'in') desc, m.received_at desc
             limit 3) x)
    from todo t
$$;
revoke execute on function public.contact_learn_queue(uuid, integer) from public, anon, authenticated;
grant execute on function public.contact_learn_queue(uuid, integer) to service_role;

-- 3. as in 0112 (20261008000112), the learned email moves with the card (kept when the group's person already has one)
create or replace function public.vendor_contact_to_rep_group(p_contact uuid)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  c public.vendor_emails;
  g uuid;
  gid uuid;
  same uuid[];
begin
  select * into c from public.vendor_emails where id = p_contact;
  if not found then raise exception 'That contact is gone'; end if;
  if auth.uid() is not null and not (public.user_in_org(c.organization_id) and public.user_can_edit()) then raise exception 'Not allowed'; end if;
  select rep_group_id into g from public.vendors where id = c.vendor_id;
  if g is null then raise exception 'This vendor does not buy through a rep group'; end if;

  if c.email is not null then
    select id into gid from public.rep_group_contacts where rep_group_id = g and lower(email) = lower(c.email) limit 1;
  end if;
  if gid is null then
    insert into public.rep_group_contacts (organization_id, rep_group_id, name, title, email, phone, phones, notes, learned_email_id)
    values (c.organization_id, g, c.contact_name, c.title, lower(c.email), c.phone, coalesce(c.phones, '[]'::jsonb), c.notes, c.learned_email_id)
    returning id into gid;
  else
    update public.rep_group_contacts
       set name = coalesce(name, c.contact_name), title = coalesce(title, c.title), phone = coalesce(phone, c.phone),
           phones = case when coalesce(jsonb_array_length(phones), 0) = 0 then coalesce(c.phones, '[]'::jsonb) else phones end,
           learned_email_id = coalesce(learned_email_id, c.learned_email_id)
     where id = gid;
  end if;

  -- this card and the same person on the group's other vendors
  select array_agg(ve.id) into same
    from public.vendor_emails ve join public.vendors v on v.id = ve.vendor_id
   where ve.id = c.id or (c.email is not null and v.rep_group_id = g and lower(ve.email) = lower(c.email));
  update public.vendors set assigned_rep_group_contact_id = gid, assigned_rep_contact_id = null where assigned_rep_contact_id = any (same);
  delete from public.vendor_emails where id = any (same);
  return gid;
end;
$$;
revoke execute on function public.vendor_contact_to_rep_group(uuid) from public, anon;
grant execute on function public.vendor_contact_to_rep_group(uuid) to authenticated, service_role;
