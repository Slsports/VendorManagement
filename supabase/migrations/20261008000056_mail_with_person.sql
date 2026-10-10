-- 0077 — All mail with one person (Dana, Oct 10: "click on the name of the 'from' email and have it bring up all
-- my emails with them in chronological order newest to oldest"). Every email from, to or copied to that
-- address, newest first; p_company widens it to everyone at the same address ending (@acme.com), except the
-- free mail services (gmail, yahoo…) where it stays the one person. Runs as the user, so mail RLS applies;
-- deleted conversations are left out.
create or replace function public.mail_free_domain(p_domain text) returns boolean
language sql immutable set search_path = public as $$
  select lower(coalesce(p_domain, '')) in ('gmail.com', 'googlemail.com', 'yahoo.com', 'ymail.com', 'hotmail.com', 'outlook.com', 'live.com', 'msn.com',
    'aol.com', 'icloud.com', 'me.com', 'mac.com', 'comcast.net', 'att.net', 'sbcglobal.net', 'verizon.net', 'cox.net', 'charter.net', 'protonmail.com', 'proton.me')
$$;
grant execute on function public.mail_free_domain(text) to authenticated, service_role;

create or replace function public.mail_with(p_org uuid, p_email text, p_company boolean default false, p_limit integer default 1000)
returns table (id uuid, thread_id uuid, direction text, from_email text, from_name text, to_emails text[], cc_emails text[], subject text,
               snippet text, received_at timestamptz, has_attachments boolean, vendor_id uuid, vendor_name text)
language sql stable security invoker set search_path = public as $$
  with w as (
    select lower(trim(p_email)) as addr, split_part(lower(trim(p_email)), '@', 2) as dom,
           coalesce(p_company, false) and not public.mail_free_domain(split_part(lower(trim(p_email)), '@', 2)) as co
  )
  select e.id, e.thread_id, e.direction, e.from_email, e.from_name, e.to_emails, e.cc_emails, coalesce(e.subject, t.subject),
         e.snippet, e.received_at, e.has_attachments, coalesce(e.vendor_id, t.vendor_id), v.name
    from public.emails e
    join public.email_threads t on t.id = e.thread_id
    left join public.vendors v on v.id = coalesce(e.vendor_id, t.vendor_id)
    cross join w
   where e.organization_id = p_org and t.deleted_at is null and w.addr like '%_@_%'
     and exists (select 1 from unnest(array[e.from_email] || e.to_emails || e.cc_emails) a(x)
                  where case when w.co then split_part(lower(a.x), '@', 2) = w.dom else lower(a.x) = w.addr end)
   order by e.received_at desc
   limit least(coalesce(p_limit, 1000), 2000)
$$;
revoke execute on function public.mail_with(uuid, text, boolean, integer) from public, anon;
grant execute on function public.mail_with(uuid, text, boolean, integer) to authenticated, service_role;
