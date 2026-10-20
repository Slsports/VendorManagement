-- 0204 — Recent Activity on the vendor page (Dana, Oct 20: "when we first open a vendor I'd like a bulleted summary of
-- 'Recent Activity' … date and brief, one sentence summary of what happened … maybe do the last 5 interactions").
--   • Claude writes one plain sentence for each email in a vendor's Primary mail, once, as it comes in
--     (emails.activity_line). Thank-yous, "got it", out-of-office and automatic notices are marked minor and left out.
--   • The vendor page shows the last 5, newest first; each opens its email. An email not read yet shows its subject.
--   • The line stays on the email itself, so private mail keeps its privacy (email RLS: owner and admin, or shared).
--   • Back-check: the queue takes each vendor's newest unread emails first, until every vendor has 5 lines.

alter table public.emails add column if not exists activity_line text;
alter table public.emails add column if not exists activity_minor boolean;
alter table public.emails add column if not exists activity_read_at timestamptz;
comment on column public.emails.activity_line is 'Recent Activity: one sentence on what happened in this email, written by Claude';
comment on column public.emails.activity_minor is 'Recent Activity: a thank-you, "got it", out-of-office or automatic notice, left out of the list';

-- A vendor's Primary mail, the same conversations as its Mail tab.
create or replace function public.vendor_recent_activity(p_vendor uuid, p_limit int default 5)
returns table (email_id uuid, thread_id uuid, received_at timestamptz, direction text, line text, subject text, from_name text, from_email text)
language sql stable security invoker set search_path = public as $$
  select e.id, e.thread_id, e.received_at, e.direction, e.activity_line, coalesce(nullif(e.subject, ''), t.subject), e.from_name, e.from_email
    from public.email_threads t
    join public.emails e on e.thread_id = t.id
   where (t.vendor_id = p_vendor or t.tagged_vendor_ids @> array[p_vendor])
     and t.deleted_at is null and t.view = 'attention' and not coalesce(e.is_bulk, false)
     and not (e.activity_read_at is not null and coalesce(e.activity_minor, false))
   order by e.received_at desc
   limit least(greatest(coalesce(p_limit, 5), 1), 50)
$$;
revoke execute on function public.vendor_recent_activity(uuid, int) from public, anon;
grant execute on function public.vendor_recent_activity(uuid, int) to authenticated, service_role;

-- For gmail-sync: emails that still need their sentence, each vendor's newest first (round by round across vendors),
-- and only until that vendor has 5 sentences newer than anything left.
create or replace function public.mail_activity_queue(p_org uuid, p_limit int default 20)
returns table (email_id uuid, direction text, from_email text, from_name text, sender_name text, to_emails text[], subject text, body_text text, sent_on date)
language sql stable security definer set search_path = public as $$
  with ve as (
    select distinct v.id as vendor_id, e.id, e.received_at, e.activity_read_at, coalesce(e.activity_minor, false) as minor
      from public.emails e
      join public.email_threads t on t.id = e.thread_id
      cross join lateral unnest(array_append(coalesce(t.tagged_vendor_ids, '{}'::uuid[]), t.vendor_id)) as v(id)
     where e.organization_id = p_org and t.deleted_at is null and t.view = 'attention' and v.id is not null
       and not coalesce(e.is_bulk, false)
  ), cut as (
    select vendor_id, (array_agg(received_at order by received_at desc))[5] as cutoff
      from ve where activity_read_at is not null and not minor group by vendor_id
  ), todo as (
    select ve.id, ve.received_at, row_number() over (partition by ve.vendor_id order by ve.received_at desc) as rn
      from ve left join cut on cut.vendor_id = ve.vendor_id
     where ve.activity_read_at is null and (cut.cutoff is null or ve.received_at > cut.cutoff)
  ), pick as (
    select id, min(rn) as rn, max(received_at) as received_at from todo group by id
    order by min(rn), max(received_at) desc limit greatest(coalesce(p_limit, 20), 1)
  )
  select e.id, e.direction, e.from_email, e.from_name, p.full_name, e.to_emails, e.subject, left(e.body_text, 2500), (e.received_at at time zone 'America/Los_Angeles')::date
    from pick
    join public.emails e on e.id = pick.id
    left join public.profiles p on p.id = e.sent_by
   order by pick.rn, pick.received_at desc
$$;
revoke execute on function public.mail_activity_queue(uuid, int) from public, anon, authenticated;
grant execute on function public.mail_activity_queue(uuid, int) to service_role;
