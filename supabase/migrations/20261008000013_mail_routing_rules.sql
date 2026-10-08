-- 0034 — Mail routing rules (Dana, Oct 8). The vendor clues themselves (PO numbers decide; a first-name
-- line like Angie needs another clue; "Worldwide" alone never decides) live in
-- supabase/functions/_shared/mailMatch.ts. Here: a web address that contains a rep group's name
-- (dandylinesllc.com → DandyLines / Diverse Marketing) is that rep group, and existing mail can be
-- matched again under the new rules.

-- The words of a name squeezed together, one entry per slash part, tags dropped:
-- "DandyLines / Diverse Marketing" → {dandylines, diversemarketing}.
create or replace function public.mail_name_keys(p_name text)
returns text[]
language sql immutable
as $$
  select coalesce(array_agg(k) filter (where length(k) >= 4), '{}')
    from (
      select regexp_replace(regexp_replace(lower(trim(part)), '\m(inc|llc|ltd|co|corp|company|the|usa|group)\M', '', 'g'), '[^a-z0-9]', '', 'g') as k
        from unnest(string_to_array(regexp_replace(regexp_replace(coalesce(p_name, ''), '\([^)]*\)', ' ', 'g'), '\s+-\s+.*$', ''), '/')) as part
    ) x
$$;

-- The part of a domain that names the company: mail.dandylinesllc.com → dandylinesllc.
create or replace function public.mail_domain_label(p_domain text)
returns text
language sql immutable
as $$
  select regexp_replace(
    case when p ~ '\.(co|com|net|org)\.[a-z]{2}$' then split_part(p, '.', greatest(array_length(string_to_array(p, '.'), 1) - 2, 1))
         else split_part(p, '.', greatest(array_length(string_to_array(p, '.'), 1) - 1, 1)) end,
    '[^a-z0-9]', '', 'g')
  from (select lower(coalesce(p_domain, '')) as p) d
$$;

-- Rep groups whose name the web address contains (or starts) — dandylinesllc → dandylines. When several
-- fit, the longest name wins.
create or replace function public.mail_domain_rep_groups(p_org uuid, p_domain text)
returns uuid[]
language sql stable security definer
set search_path = public
as $$
  with lab as (select public.mail_domain_label(p_domain) as l),
  hits as (
    select g.id, length(k) as n
      from public.rep_groups g, unnest(public.mail_name_keys(g.name)) as k, lab
     where g.organization_id = p_org and g.is_active
       and length(lab.l) >= 4
       and not public.mail_is_freemail(p_domain)
       and (lab.l = k or (length(k) >= 6 and lab.l like k || '%') or (length(lab.l) >= 6 and k like lab.l || '%'))
  )
  select coalesce(array_agg(distinct id) filter (where n = (select max(n) from hits)), '{}') from hits
$$;

alter table public.email_senders add column if not exists domain_rep_group_ids uuid[] not null default '{}';
comment on column public.email_senders.domain_rep_group_ids is 'Rep groups whose name this web address contains (dandylinesllc.com → DandyLines). One → it is that rep group.';

create or replace function public.email_senders_domain_rep_groups()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.is_domain then new.domain_rep_group_ids := public.mail_domain_rep_groups(new.organization_id, new.sender_key); end if;
  return new;
end;
$$;
drop trigger if exists email_senders_domain_rep_groups on public.email_senders;
create trigger email_senders_domain_rep_groups before insert on public.email_senders
  for each row execute function public.email_senders_domain_rep_groups();
revoke execute on function public.email_senders_domain_rep_groups() from public, anon, authenticated;

update public.email_senders s set domain_rep_group_ids = public.mail_domain_rep_groups(s.organization_id, s.sender_key)
 where s.is_domain;

-- A sender is a rep group when it writes from a rep person's address or that company's domain, or when
-- its web address names exactly one rep group and no vendor.
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
    with addrs as (
      select g.id as rep_group_id, g.name as rep_name, lower(trim(g.email)) as email
        from public.rep_groups g where g.organization_id = p_org and g.is_active and g.email is not null
      union
      select g.id, g.name, lower(trim(c.email))
        from public.rep_group_contacts c join public.rep_groups g on g.id = c.rep_group_id and g.is_active
       where c.organization_id = p_org and c.email is not null
    ), hits as (
      select s.id as sender_id, s.review_item_id, a.rep_group_id, a.rep_name, 1 as how
        from public.email_senders s
        join addrs a on (not s.is_domain and s.sender_key = a.email)
                     or (s.is_domain and s.sender_key = public.mail_domain(a.email) and not public.mail_is_freemail(public.mail_domain(a.email)))
       where s.organization_id = p_org and s.kind = 'unknown' and (p_sender_ids is null or s.id = any (p_sender_ids))
      union all
      select s.id, s.review_item_id, g.id, g.name, 2
        from public.email_senders s join public.rep_groups g on g.id = s.domain_rep_group_ids[1]
       where s.organization_id = p_org and s.kind = 'unknown' and s.is_domain and cardinality(s.domain_rep_group_ids) = 1
         and cardinality(s.domain_vendor_ids) = 0   -- also looks like a vendor (Eagle Claw): a person decides
         and (p_sender_ids is null or s.id = any (p_sender_ids))
    )
    select distinct on (sender_id) * from hits order by sender_id, how, rep_name
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

select public.mail_match_rep_senders(o.id, null) from public.organizations o where exists (select 1 from public.email_senders s where s.organization_id = o.id);

-- Match existing mail again after its clues were re-read (scripts/rematch-mail.mjs): file what can be
-- filed now and refresh the "Who is this mail from?" proposals. Views are left as they are.
create or replace function public.mail_rematch(p_org uuid, p_email_ids uuid[])
returns integer
language plpgsql security definer
set search_path = public
as $$
declare
  r        record;
  v_linked integer := 0;
begin
  for r in select id from public.emails where organization_id = p_org and id = any (p_email_ids) and vendor_id is null order by received_at loop
    if public.mail_link_email(r.id) then v_linked := v_linked + 1; end if;
  end loop;
  for r in select distinct thread_id from public.emails where id = any (p_email_ids) loop
    perform public.mail_refresh_thread(r.thread_id, true);
  end loop;
  for r in select distinct e.sender_id from public.emails e join public.email_senders s on s.id = e.sender_id
            where e.id = any (p_email_ids) and s.kind = 'unknown' loop
    perform public.mail_refresh_sender(r.sender_id);
  end loop;
  return v_linked;
end;
$$;
revoke execute on function public.mail_rematch(uuid, uuid[]) from public, anon, authenticated;
grant execute on function public.mail_rematch(uuid, uuid[]) to service_role;

-- The old single Rep on a vendor was our rep: star the matching contact where none is starred yet.
update public.vendors v set assigned_rep_contact_id = e.id
  from public.vendor_emails e
 where e.vendor_id = v.id and e.contact_type = 'rep' and v.assigned_rep_contact_id is null and v.assigned_rep_group_contact_id is null
   and nullif(trim(v.rep_name), '') is not null and lower(trim(e.contact_name)) = lower(trim(v.rep_name));
