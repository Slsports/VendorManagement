-- 0030 — Known reps are recognized by their address (Dana, Oct 8: "Maryellen reps for more than just
-- Planet Cotton"). A sender whose address (or, for a company domain, whose domain) matches a rep group's
-- email on file is that rep group at once: no review card, and each of its emails is filed to the one
-- vendor of that rep group it names. Emails naming none or several of the rep's vendors stay unfiled in
-- Mail for a person.

create or replace function public.mail_match_rep_senders(p_org uuid, p_sender_ids uuid[] default null)
returns integer
language plpgsql security definer
set search_path = public
as $$
declare
  r        record;
  e        record;
  v_count  integer := 0;
begin
  for r in
    select distinct on (s.id) s.id as sender_id, s.review_item_id, g.id as rep_group_id, g.name as rep_name
      from public.email_senders s
      join public.rep_groups g on g.organization_id = s.organization_id and g.is_active and g.email is not null
     where s.organization_id = p_org and s.kind = 'unknown'
       and (p_sender_ids is null or s.id = any (p_sender_ids))
       and (
         (not s.is_domain and s.sender_key = lower(trim(g.email)))
         or (s.is_domain and s.sender_key = public.mail_domain(g.email) and not public.mail_is_freemail(public.mail_domain(g.email)))
       )
     order by s.id, g.name
  loop
    update public.email_senders set kind = 'rep_group', rep_group_id = r.rep_group_id, decided_at = now() where id = r.sender_id;
    update public.review_items set status = 'accepted', resolved_at = now(), resolution_note = 'Known rep group: ' || r.rep_name
     where id = r.review_item_id and status = 'pending';
    for e in select id, thread_id from public.emails where sender_id = r.sender_id and vendor_id is null loop
      perform public.mail_link_email(e.id);
      perform public.mail_refresh_thread(e.thread_id, false);
    end loop;
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;
revoke execute on function public.mail_match_rep_senders(uuid, uuid[]) from public, anon, authenticated;
grant execute on function public.mail_match_rep_senders(uuid, uuid[]) to service_role;

create or replace function public.mail_process(p_org uuid, p_email_ids uuid[], p_backfill boolean default false)
returns jsonb
language plpgsql security definer
set search_path = public
as $$
declare
  r        record;
  v_linked integer := 0;
begin
  -- Senders writing from a rep group's address on file are that rep group, before anything else.
  perform public.mail_match_rep_senders(p_org, (select array_agg(distinct sender_id) from public.emails where id = any (p_email_ids) and sender_id is not null));
  for r in select id from public.emails where organization_id = p_org and id = any (p_email_ids) order by received_at loop
    if public.mail_link_email(r.id) then v_linked := v_linked + 1; end if;
  end loop;
  for r in select distinct thread_id from public.emails where id = any (p_email_ids) loop
    perform public.mail_refresh_thread(r.thread_id, p_backfill);
  end loop;
  for r in select distinct e.sender_id from public.emails e join public.email_senders s on s.id = e.sender_id
            where e.id = any (p_email_ids) and s.kind = 'unknown' loop
    perform public.mail_refresh_sender(r.sender_id);
  end loop;
  perform public.mail_classify(p_org, p_email_ids);
  return jsonb_build_object('linked', v_linked);
end;
$$;

-- Maryellen and every other rep group with an email on file: recognize them now.
select public.mail_match_rep_senders(o.id, null) from public.organizations o where exists (select 1 from public.email_senders s where s.organization_id = o.id);
