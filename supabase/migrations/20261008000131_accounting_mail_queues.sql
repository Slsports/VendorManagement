-- 0131 — Old billing@ history stays out of the orders@ Claude steps (Oct 16). The billing@ backfill (two years of mail)
-- was feeding the sort and reply-check queues, which took the whole gmail-sync budget every minute and starved the
-- artwork and promise steps (Dana's approval reply to Planet Cotton was stuck). Accounting-mailbox mail is sorted and
-- reply-checked only for the last 30 days; the rest is covered by the accounting filing and the contacts.
create or replace function public.mail_unsure_emails(p_org uuid, p_limit integer default 40)
returns table (id uuid, from_email text, from_name text, subject text, snippet text, body_text text, has_attachments boolean)
language sql stable security definer
set search_path = public
as $$
  select e.id, e.from_email, e.from_name, e.subject, e.snippet, left(e.body_text, 1500), e.has_attachments
    from public.emails e
    left join public.email_senders s on s.id = e.sender_id
   where e.organization_id = p_org and e.direction = 'in' and e.ai_read_at is null
     and e.view_how is distinct from 'manual'
     and e.is_bulk is not null
     and (e.mailbox_id is null or e.received_at > now() - interval '30 days'
          or not exists (select 1 from public.mailboxes m where m.id = e.mailbox_id and m.kind = 'accounting'))
     and public.mail_view_for(e.direction, e.labels, e.subject, e.is_bulk,
           public.mail_address_rule(e.organization_id, e.mailbox_id, e.from_email, public.mail_email_kind(e.labels, e.subject, e.is_bulk)),
           s.view_rule, s.kind,
           exists (select 1 from public.emails o where o.thread_id = e.thread_id and o.direction = 'out'), null) = array['attention', 'signals']
   order by e.received_at desc
   limit p_limit
$$;

create or replace function public.mail_reply_queue(p_org uuid, p_limit integer default 20)
returns table (email_id uuid, thread_id uuid, subject text, from_email text, from_name text, body_text text, sender_kind text, carrier text)
language sql stable security definer
set search_path = public
as $$
  select e.id, e.thread_id, e.subject, e.from_email, e.from_name, left(coalesce(e.body_text, e.snippet, ''), 6000), s.kind, c.name
    from public.email_threads t
    join lateral (select * from public.emails x where x.thread_id = t.id and x.direction <> 'internal' order by x.received_at desc limit 1) e on true
    left join public.email_senders s on s.id = e.sender_id
    left join public.carriers c on c.id = s.carrier_id
   where t.organization_id = p_org and t.status = 'waiting_on_us' and t.deleted_at is null and e.direction = 'in' and e.reply_read_at is null
     and (t.mailbox_id is null or e.received_at > now() - interval '30 days'
          or not exists (select 1 from public.mailboxes m where m.id = t.mailbox_id and m.kind = 'accounting'))
   order by e.received_at desc
   limit p_limit
$$;
