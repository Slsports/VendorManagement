-- 0318 — Activity feed loads again (Dana, Nov 6: "Every vendor I have pulled up shows this same thing for activity feed,
-- there is a glitch" — "Could not load the activity.").
-- Confirmed in the logs: the feed's email list (vendor_recent_activity) hit the 8-second database limit. With ~20,600
-- Primary conversations it checked who may see each one before narrowing to the vendor (the "tagged to this vendor"
-- test cannot run ahead of the privacy check), so it took ~7.8 s for a buyer and longer for Dana.
-- Now a small helper finds the vendor's conversation ids first (by vendor and by tag, using their indexes), and the
-- list reads only those, still as the person, so private mail stays private exactly as before. ~7 ms.
set local lock_timeout = '5s';

-- Only ids, only in the person's own company; what they may read is still decided by the mail privacy rules.
create or replace function public.vendor_thread_ids(p_vendor uuid)
returns uuid[] language sql stable security definer set search_path = '' as $$
  select coalesce(array_agg(t.id), '{}') from (
    select id, organization_id from public.email_threads where vendor_id = p_vendor and deleted_at is null and view = 'attention'
    union
    select id, organization_id from public.email_threads where tagged_vendor_ids @> array[p_vendor] and deleted_at is null and view = 'attention'
  ) t where public.user_in_org(t.organization_id)
$$;
revoke execute on function public.vendor_thread_ids(uuid) from public, anon;
grant execute on function public.vendor_thread_ids(uuid) to authenticated, service_role;

create or replace function public.vendor_recent_activity(p_vendor uuid, p_limit int default 5)
returns table (email_id uuid, thread_id uuid, received_at timestamptz, direction text, line text, subject text, from_name text, from_email text)
language sql stable security invoker set search_path = public as $$
  select e.id, e.thread_id, e.received_at, e.direction, e.activity_line, coalesce(nullif(e.subject, ''), t.subject), e.from_name, e.from_email
    from public.email_threads t
    join public.emails e on e.thread_id = t.id
   where t.id = any(public.vendor_thread_ids(p_vendor))
     and t.deleted_at is null and t.view = 'attention' and not coalesce(e.is_bulk, false)
     and not (e.activity_read_at is not null and coalesce(e.activity_minor, false))
   order by e.received_at desc
   limit least(greatest(coalesce(p_limit, 5), 1), 50)
$$;
revoke execute on function public.vendor_recent_activity(uuid, int) from public, anon;
grant execute on function public.vendor_recent_activity(uuid, int) to authenticated, service_role;
