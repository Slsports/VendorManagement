-- 0248 — Rep group mail (Dana, Oct 27): "emails between us and reps that rep for more than one company have their
-- correspondence filed with the vendor that the communication is talking about, along with an area in the rep group
-- that lists all the emails we have received from them all in one place."
-- • rep_group_thread_ids: every conversation with a rep group's people (their mail in, our mail out to them), for the
--   Mail box on the rep group page. Each conversation also shows which vendors it was filed to (tagged_vendor_ids).
-- • mail_rep_queue: rep mail Claude has not yet read for the vendors it names: all history (the 90-day limit is lifted),
--   and our own emails to a rep as well as theirs, so a conversation we start is filed to its vendors too.

create or replace function public.rep_group_thread_ids(p_org uuid, p_rep uuid)
returns uuid[] language sql stable security invoker set search_path = public as $$
  with addrs as (
    select lower(c.email) as email from public.rep_group_contacts c where c.rep_group_id = p_rep and c.email is not null
    union select lower(g.email) from public.rep_groups g where g.id = p_rep and g.email is not null
  )
  select coalesce(array_agg(distinct e.thread_id), '{}')
  from public.emails e
  left join public.email_senders s on s.id = e.sender_id
  where e.organization_id = p_org and e.mailbox_id is null and e.thread_id is not null
    and ((s.kind = 'rep_group' and s.rep_group_id = p_rep)
      or (e.direction = 'out' and exists (select 1 from addrs a where a.email = any (select lower(x) from unnest(e.to_emails || e.cc_emails) x))))
$$;
revoke execute on function public.rep_group_thread_ids(uuid, uuid) from public, anon;
grant execute on function public.rep_group_thread_ids(uuid, uuid) to authenticated, service_role;

create or replace function public.mail_rep_queue(p_org uuid, p_limit integer default 8)
returns table (id uuid, subject text, body_text text, direction text, received_at timestamptz)
language sql stable security definer set search_path = public as $$
  select e.id, e.subject, e.body_text, e.direction, e.received_at
  from public.emails e
  left join public.email_senders s on s.id = e.sender_id
  where e.organization_id = p_org and e.mailbox_id is null and e.vendors_read_at is null and e.is_bulk is not true and e.copy_of is null
    and ((e.direction = 'in' and s.kind = 'rep_group')
      or (e.direction = 'out' and exists (
            select 1 from public.rep_group_contacts c join public.rep_groups g on g.id = c.rep_group_id
            where g.organization_id = p_org and c.email is not null and lower(c.email) = any (select lower(x) from unnest(e.to_emails || e.cc_emails) x))))
  order by e.received_at desc
  limit p_limit
$$;
revoke execute on function public.mail_rep_queue(uuid, integer) from public, anon, authenticated;
grant execute on function public.mail_rep_queue(uuid, integer) to service_role;
