-- 0106 — Sent mail (Dana, Oct 12): "we need a sent mail folder so we can quickly check if we sent an email to anyone", in
-- Mail and on each vendor's Mail box. One row per email we sent, newest first, searchable by who it went to (address or
-- vendor) and subject. Runs as the person asking, so private mailboxes stay private (RLS on emails).
create or replace function public.list_sent_emails(p_org uuid, p_mailbox uuid default null, p_vendor uuid default null, p_q text default null, p_limit integer default 300)
returns table (id uuid, thread_id uuid, to_emails text[], cc_emails text[], subject text, snippet text, sent_at timestamptz,
               vendor_id uuid, vendor_name text, sent_by_name text, has_attachments boolean)
language sql stable security invoker
set search_path = public
as $$
  select e.id, e.thread_id, e.to_emails, e.cc_emails, e.subject, e.snippet, e.received_at,
         coalesce(e.vendor_id, t.vendor_id), v.name,
         coalesce(p.full_name, e.promise->>'writer'), e.has_attachments
    from public.emails e
    join public.email_threads t on t.id = e.thread_id
    left join public.vendors v on v.id = coalesce(e.vendor_id, t.vendor_id)
    left join public.profiles p on p.id = e.sent_by
   where e.organization_id = p_org and e.direction = 'out' and t.deleted_at is null
     and case when p_mailbox is null then (e.mailbox_id is null or t.shared_at is not null) else e.mailbox_id = p_mailbox end
     and (p_vendor is null or e.vendor_id = p_vendor or t.vendor_id = p_vendor or p_vendor = any (t.tagged_vendor_ids))
     and (nullif(trim(p_q), '') is null
          or e.subject ilike '%' || trim(p_q) || '%'
          or array_to_string(e.to_emails || e.cc_emails, ' ') ilike '%' || trim(p_q) || '%'
          or v.name ilike '%' || trim(p_q) || '%')
   order by e.received_at desc
   limit least(coalesce(p_limit, 300), 1000)
$$;
revoke execute on function public.list_sent_emails(uuid, uuid, uuid, text, integer) from public, anon;
grant execute on function public.list_sent_emails(uuid, uuid, uuid, text, integer) to authenticated, service_role;
