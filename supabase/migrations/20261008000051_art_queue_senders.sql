-- 0072 — Artwork check skips senders marked "not a vendor" and our own staff (the sender kinds in use: vendor, rep_group,
-- platform, unknown are read; marketing, carrier, not_vendor, internal are not).
create or replace function public.mail_art_queue(p_org uuid, p_limit integer default 20)
returns table (email_id uuid, thread_id uuid, direction text, subject text, from_name text, body_text text, attachments text[], art_status text)
language sql stable security definer set search_path = public as $$
  select e.id, e.thread_id, e.direction, e.subject, coalesce(e.from_name, e.from_email), left(coalesce(e.body_text, e.snippet, ''), 4000),
         (select coalesce(array_agg(a.file_name order by a.file_name), '{}') from public.email_attachments a where a.email_id = e.id), t.art_status
    from public.emails e
    join public.email_threads t on t.id = e.thread_id
    left join public.email_senders s on s.id = e.sender_id
   where e.organization_id = p_org and e.art_read_at is null and t.deleted_at is null
     and e.received_at > now() - interval '60 days'
     and ((e.direction = 'in' and not coalesce(e.is_bulk, false) and coalesce(s.kind, 'unknown') not in ('marketing', 'carrier', 'not_vendor', 'internal'))
          or (e.direction = 'out' and t.art_status in ('waiting', 'needs_changes')))
   order by e.received_at desc
   limit p_limit
$$;
revoke execute on function public.mail_art_queue(uuid, integer) from public, anon, authenticated;
grant execute on function public.mail_art_queue(uuid, integer) to service_role;
