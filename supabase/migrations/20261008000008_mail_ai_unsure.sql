-- 0029 — Only the truly unclear emails go to Claude: not order, invoice or shipping mail, not replies, not
-- conversations we wrote in (the rules already keep those in Needs attention). Claude's earlier answers
-- on such emails are cleared so the rules decide them again.

create or replace function public.mail_unsure_emails(p_org uuid, p_limit integer default 40)
returns table (id uuid, from_email text, from_name text, subject text, snippet text, body_text text, has_attachments boolean)
language sql stable security definer
set search_path = public
as $$
  select e.id, e.from_email, e.from_name, e.subject, e.snippet, left(e.body_text, 1500), e.has_attachments
    from public.emails e
    left join public.email_senders s on s.id = e.sender_id
   where e.organization_id = p_org and e.direction = 'in' and e.ai_read_at is null
     and e.view_how is distinct from 'manual' and s.view_rule is null
     and e.is_bulk is not null
     and not public.mail_is_transactional(e.subject)
     and not exists (select 1 from public.emails o where o.thread_id = e.thread_id and o.direction = 'out')
     and public.mail_view_for(e.direction, e.labels, e.subject, e.from_email, e.is_bulk, null,
           exists (select 1 from public.emails o where o.thread_id = e.thread_id and o.direction = 'out'), null) = array['attention', 'signals']
   order by e.received_at desc
   limit p_limit
$$;

update public.emails set ai_view = null
 where ai_view is not null and (public.mail_is_transactional(subject)
   or exists (select 1 from public.emails o where o.thread_id = emails.thread_id and o.direction = 'out'));
select public.mail_classify(o.id, null) from public.organizations o where exists (select 1 from public.emails e where e.organization_id = o.id);
