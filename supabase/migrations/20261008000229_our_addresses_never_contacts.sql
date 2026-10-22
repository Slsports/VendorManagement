-- 0229 — Our own addresses are never a vendor's or rep group's contact (Dana, Oct 22). Filing Lauren Marsh's sender saved
-- orders@shaverlakesports.com and billing.slsports@gmail.com as DandyLines contacts: forwarded copies of her mail come
-- from our addresses. is_our_address(): staff logins, the organization's own addresses, our mailboxes and our mail
-- domains. Filing a rep sender, New rep group and contact learning skip them. Back-check: our addresses saved as any
-- vendor's or rep group's contact are deleted (they were filed in the wrong place). DandyLines' main email is
-- donna@dandylinesllc.com, the address we mostly use (Dana, Oct 22).

set local lock_timeout = '5s';

create or replace function public.is_our_address(p_org uuid, p_email text) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(nullif(trim(p_email), ''), '') <> '' and (
    exists (select 1 from public.profiles p where p.organization_id = p_org and lower(p.email) = lower(trim(p_email)))
    or exists (select 1 from public.organizations o where o.id = p_org and lower(trim(p_email)) = any (select lower(x) from unnest(coalesce(o.own_addresses, '{}')) x))
    or exists (select 1 from public.mail_accounts m where m.organization_id = p_org
                and (lower(m.mailbox) = lower(trim(p_email)) or public.mail_domain(p_email) = lower(split_part(m.mailbox, '@', 2))
                     or public.mail_domain(p_email) = any (select lower(d) from unnest(coalesce(m.internal_domains, '{}')) d)))
    or exists (select 1 from public.mailboxes b where b.organization_id = p_org and lower(b.address) = lower(trim(p_email))));
$$;
revoke execute on function public.is_our_address(uuid, text) from public, anon;
grant execute on function public.is_our_address(uuid, text) to authenticated, service_role;

CREATE OR REPLACE FUNCTION public.rep_group_file_sender(p_sender uuid, p_group uuid, p_note text, p_user uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  s   public.email_senders%rowtype;
  a   record;
  e   record;
begin
  select * into s from public.email_senders where id = p_sender for update;
  if not found or not exists (select 1 from public.rep_groups where id = p_group and organization_id = s.organization_id) then return; end if;
  update public.email_senders set kind = 'rep_group', rep_group_id = p_group, vendor_id = null, decided_by = p_user, decided_at = now(),
         sorted_at = coalesce(sorted_at, now()), rep_lines_read_at = null
   where id = p_sender;
  update public.review_items set status = 'accepted', resolved_by = p_user, resolved_at = now(), resolution_note = left(coalesce(p_note, 'Rep group'), 300)
   where id = s.review_item_id and status = 'pending';
  -- the people writing from it (orders@ mail only) become the group's contacts
  for a in select lower(em.from_email) as email, max(em.from_name) as name from public.emails em
            where em.sender_id = p_sender and em.direction = 'in' and em.mailbox_id is null and em.from_email is not null
              and not public.is_our_address(s.organization_id, em.from_email)
            group by 1 order by count(*) desc limit 5 loop
    if not exists (select 1 from public.rep_group_contacts c where c.rep_group_id = p_group and lower(c.email) = a.email) then
      insert into public.rep_group_contacts (organization_id, rep_group_id, name, email, notes)
      values (s.organization_id, p_group, a.name, a.email, 'Added from the mail');
    end if;
  end loop;
  for e in select id, thread_id from public.emails where sender_id = p_sender and vendor_id is null loop
    perform public.mail_link_email(e.id);
    perform public.mail_refresh_thread(e.thread_id, false);
  end loop;
end;
$function$;

CREATE OR REPLACE FUNCTION public.rep_group_from_sender(p_sender uuid, p_name text, p_website text, p_phone text, p_contacts jsonb, p_vendors uuid[])
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  s        public.email_senders%rowtype;
  v_group  uuid;
  v_new    boolean := false;
  c        jsonb;
  v_people integer := 0;
  v_linked integer;
  v_lines  jsonb;
  v_tags   integer := 0;
  r        record;
  v_first  jsonb;
begin
  if not public.user_can_edit() then raise exception 'Only admins, managers and buyers add rep groups' using errcode = '42501'; end if;
  select * into s from public.email_senders where id = p_sender;
  if not found or not public.user_in_org(s.organization_id) then raise exception 'Sender not found' using errcode = '23503'; end if;
  if nullif(trim(p_name), '') is null then raise exception 'Name the rep group' using errcode = '22023'; end if;
  if exists (select 1 from unnest(coalesce(p_vendors, '{}')) x where not exists (select 1 from public.vendors where id = x and organization_id = s.organization_id)) then
    raise exception 'Vendor not found' using errcode = '23503';
  end if;

  -- the same name already in Rep Groups is that group, never a second copy
  select id into v_group from public.rep_groups
   where organization_id = s.organization_id and lower(trim(name)) = lower(trim(p_name)) order by is_active desc, created_at limit 1;
  if jsonb_typeof(p_contacts) = 'array' then v_first := p_contacts->0; end if;
  if v_group is null then
    insert into public.rep_groups (organization_id, name, website, phone, email, contact_name)
    values (s.organization_id, trim(p_name), nullif(trim(p_website), ''), nullif(trim(p_phone), ''),
            nullif(lower(trim(v_first->>'email')), ''), nullif(trim(v_first->>'name'), ''))
    returning id into v_group;
    v_new := true;
  else
    update public.rep_groups set is_active = true, website = coalesce(website, nullif(trim(p_website), '')), phone = coalesce(phone, nullif(trim(p_phone), ''))
     where id = v_group;
  end if;

  for c in select * from jsonb_array_elements(case when jsonb_typeof(p_contacts) = 'array' then p_contacts else '[]'::jsonb end) loop
    continue when nullif(trim(c->>'name'), '') is null and nullif(trim(c->>'email'), '') is null;
    continue when public.is_our_address(s.organization_id, c->>'email');
    continue when exists (select 1 from public.rep_group_contacts x where x.rep_group_id = v_group
                           and ((nullif(trim(c->>'email'), '') is not null and lower(x.email) = lower(trim(c->>'email')))
                                or (nullif(trim(c->>'email'), '') is null and lower(x.name) = lower(trim(c->>'name')))));
    insert into public.rep_group_contacts (organization_id, rep_group_id, name, title, email, phone)
    values (s.organization_id, v_group, nullif(trim(c->>'name'), ''), nullif(trim(c->>'title'), ''), nullif(lower(trim(c->>'email')), ''), nullif(trim(c->>'phone'), ''));
    v_people := v_people + 1;
  end loop;

  v_linked := public.resolve_email_sender(p_sender, 'rep_group', null, v_group);
  -- lines with no rep group join it; a line with another rep group becomes a card
  v_lines := public.rep_group_apply_lines(p_sender, coalesce(p_vendors, '{}'), '{}');
  -- Claude still reads the mail for lines that are not vendors yet (cards)
  update public.email_senders set rep_lines_read_at = null where id = p_sender;
  -- every email, filed or not, is tagged to each vendor it names
  for r in select id from public.emails where sender_id = p_sender loop
    perform public.mail_auto_tag(r.id);
  end loop;
  select count(distinct g.email_id) into v_tags from public.email_vendor_tags g join public.emails e on e.id = g.email_id where e.sender_id = p_sender;
  insert into public.activity_log (organization_id, entity_type, entity_id, action, details, actor_id)
  values (s.organization_id, 'rep_group', v_group, case when v_new then 'created_from_mail' else 'sender_added' end,
          jsonb_build_object('sender', s.sender_key, 'people', v_people, 'lines', v_lines), auth.uid());
  return jsonb_build_object('rep_group_id', v_group, 'created', v_new, 'people', v_people, 'linked', v_linked,
                            'lines_added', coalesce(v_lines->'added', '[]'::jsonb), 'asked', coalesce((v_lines->>'asked')::int, 0), 'tagged', v_tags);
end;
$function$;

CREATE OR REPLACE FUNCTION public.contact_learn_queue(p_org uuid, p_limit integer DEFAULT 8)
 RETURNS TABLE(email text, vendor_id uuid, rep_group_id uuid, owner_name text, emails jsonb)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  with ours as (
    select lower(split_part(m.mailbox, '@', 2)) as d from public.mail_accounts m where m.organization_id = p_org
    union select lower(x) from public.mail_accounts m cross join lateral unnest(m.internal_domains) x where m.organization_id = p_org
  ), mail as (
    select e.* from public.emails e
     where e.organization_id = p_org and e.copy_of is null
       and e.received_at > now() - interval '365 days'
       and (e.mailbox_id is null or exists (select 1 from public.email_threads t where t.id = e.thread_id and t.shared_at is not null))
  ), people as (
    -- they wrote to us: the sender record says whose they are
    select lower(m.from_email) as addr, s.vendor_id, s.rep_group_id
      from mail m join public.email_senders s on s.id = m.sender_id
     where m.direction = 'in' and m.from_email like '%@%'
       and ((s.kind = 'vendor' and s.vendor_id = m.vendor_id) or (s.kind = 'rep_group' and s.rep_group_id is not null))
    union
    -- we wrote to them at the vendor's own domain (or their own address on file as the vendor's)
    select lower(a), s.vendor_id, null::uuid
      from mail m cross join lateral unnest(m.to_emails || m.cc_emails) a
      join public.email_senders s on s.organization_id = p_org and s.kind = 'vendor' and s.vendor_id = m.vendor_id
       and (s.sender_key = lower(a) or (s.is_domain and s.sender_key = lower(split_part(a, '@', 2))))
     where m.direction = 'out'
  ), todo as (
    select distinct p.addr, case when p.rep_group_id is null then p.vendor_id end as vendor_id, p.rep_group_id
      from people p
     where p.addr ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'
       and split_part(p.addr, '@', 2) not in (select d from ours)
       and not public.is_our_address(p_org, p.addr)
       and not exists (select 1 from public.contact_learning l where l.organization_id = p_org and l.email = p.addr
                         and coalesce(l.vendor_id, l.rep_group_id) = coalesce(case when p.rep_group_id is null then p.vendor_id end, p.rep_group_id))
     limit p_limit
  )
  select t.addr, t.vendor_id, t.rep_group_id,
         coalesce((select v.name from public.vendors v where v.id = t.vendor_id), (select g.name from public.rep_groups g where g.id = t.rep_group_id)),
         (select coalesce(jsonb_agg(x order by x.theirs desc, x.at desc), '[]'::jsonb) from (
            select m.id, m.direction = 'in' as theirs, m.received_at as at, m.subject, m.from_name, m.direction, left(coalesce(m.body_text, m.snippet, ''), 4000) as text
              from mail m
             where (m.direction = 'in' and lower(m.from_email) = t.addr) or (m.direction = 'out' and t.addr = any (select lower(z) from unnest(m.to_emails || m.cc_emails) z))
             order by (m.direction = 'in') desc, m.received_at desc
             limit 3) x)
    from todo t
$function$;


-- back-check: our addresses saved as contacts were filed in the wrong place; delete them (never former)
update public.vendors v set assigned_rep_group_contact_id = null
  from public.rep_group_contacts c where v.assigned_rep_group_contact_id = c.id and public.is_our_address(c.organization_id, c.email);
delete from public.rep_group_contacts c where public.is_our_address(c.organization_id, c.email);
update public.vendors v set assigned_rep_contact_id = null
  from public.vendor_emails c where v.assigned_rep_contact_id = c.id and public.is_our_address(c.organization_id, c.email);
delete from public.vendor_emails c where public.is_our_address(c.organization_id, c.email);

-- DandyLines: the address we mostly use is the main one
update public.rep_groups set email = 'donna@dandylinesllc.com' where name = 'DandyLines / Diverse Marketing' and lower(email) = 'donnah@diversemail.com';
update public.rep_group_contacts c set notes = coalesce(nullif(c.notes, '') || '. ', '') || 'Main address'
  from public.rep_groups g where g.id = c.rep_group_id and g.name = 'DandyLines / Diverse Marketing' and lower(c.email) = 'donna@dandylinesllc.com' and coalesce(c.notes, '') not ilike '%main address%';
update public.rep_group_contacts c set notes = coalesce(nullif(c.notes, '') || '. ', '') || 'For orders placed through Diverse Marketing'
  from public.rep_groups g where g.id = c.rep_group_id and g.name = 'DandyLines / Diverse Marketing' and lower(c.email) = 'donnah@diversemail.com' and coalesce(c.notes, '') not ilike '%diverse marketing%';
