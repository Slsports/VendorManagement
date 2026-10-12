-- 0102 — Rep groups learned from the mail (Dana, Oct 12): "the 20 emails from Steve Newman and @pssagency.com should have
-- been tagged to Steve Newman at Premier Sales Solutions, LLC, which is in our Rep Groups. All of the lines he reps for should
-- have been added, or asked if they should be added to his rep group. Claude needs to see if the same sender is sending us
-- emails referencing different vendors and automatically add those vendors to that rep's info. And those emails should have
-- been attached to Rapala and Pautzke separately."
-- * A rep group is recognized by its email, any of its contacts' emails, or (Claude) its name, signature or rep.
-- * A rep group sender's lines are read from its mail: vendors with no rep group join it on their own; a vendor with another
--   rep group, or a line that is not a vendor yet, becomes a "rep line" card.
-- * Each rep email is tagged to every line it names and filed to the one when it names one.

alter table public.email_senders add column if not exists rep_lines_read_at timestamptz;
alter table public.email_senders add column if not exists rep_lines_read_count integer;

-- Known rep groups: the group's email or any of its contacts' emails (address or company domain).
create or replace function public.mail_match_rep_senders(p_org uuid, p_sender_ids uuid[] default null)
returns integer
language plpgsql security definer
set search_path = public
as $$
declare
  r        record;
  v_count  integer := 0;
begin
  for r in
    with addrs as (
      select g.id as rep_group_id, g.name, lower(trim(g.email)) as email from public.rep_groups g where g.organization_id = p_org and g.is_active and g.email is not null
      union
      select g.id, g.name, lower(trim(c.email)) from public.rep_group_contacts c join public.rep_groups g on g.id = c.rep_group_id
       where g.organization_id = p_org and g.is_active and c.email is not null
    )
    select distinct on (s.id) s.id as sender_id, a.rep_group_id, a.name as rep_name
      from public.email_senders s join addrs a on true
     where s.organization_id = p_org and s.kind = 'unknown'
       and (p_sender_ids is null or s.id = any (p_sender_ids))
       and ((not s.is_domain and s.sender_key = a.email)
            or (s.is_domain and s.sender_key = public.mail_domain(a.email) and not public.mail_is_freemail(public.mail_domain(a.email))))
     order by s.id, a.name
  loop
    perform public.rep_group_file_sender(r.sender_id, r.rep_group_id, 'Known rep group: ' || r.rep_name, null);
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

-- File a sender to a rep group (no permission check: callers check). Its address joins the group's contacts.
create or replace function public.rep_group_file_sender(p_sender uuid, p_group uuid, p_note text, p_user uuid)
returns void
language plpgsql security definer
set search_path = public
as $$
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
$$;

-- A rep group's lines as read from its mail. Vendors with no rep group join it; another group's vendor, or a line that is
-- not a vendor yet, is a card. Then the sender's mail is tagged to every line it names and filed when it names one.
create or replace function public.rep_group_apply_lines(p_sender uuid, p_vendor_ids uuid[], p_unknown text[])
returns jsonb
language plpgsql security definer
set search_path = public
as $$
declare
  s        public.email_senders%rowtype;
  g        public.rep_groups%rowtype;
  v        record;
  n        text;
  e        record;
  v_added  text[] := '{}';
  v_asked  integer := 0;
begin
  select * into s from public.email_senders where id = p_sender;
  if not found or s.kind <> 'rep_group' or s.rep_group_id is null then return null; end if;
  select * into g from public.rep_groups where id = s.rep_group_id;
  update public.email_senders set rep_lines_read_at = now(), rep_lines_read_count = message_count where id = p_sender;

  for v in select x.id, x.name, x.rep_group_id, og.name as other_name from public.vendors x left join public.rep_groups og on og.id = x.rep_group_id
            where x.id = any (coalesce(p_vendor_ids, '{}')) and x.organization_id = s.organization_id and x.merged_into_id is null loop
    if v.rep_group_id is null then
      update public.vendors set rep_group_id = g.id where id = v.id;
      v_added := v_added || v.name;
    elsif v.rep_group_id <> g.id and not exists (
        select 1 from public.review_items r where r.kind = 'rep_line' and r.entity_id = v.id and r.details->>'rep_group_id' = g.id::text) then
      insert into public.review_items (organization_id, kind, entity_type, entity_id, title, details)
      values (s.organization_id, 'rep_line', 'vendor', v.id,
              format('%s writes about %s, which is with %s. Move it to %s?', g.name, v.name, v.other_name, g.name),
              jsonb_build_object('rep_group_id', g.id, 'rep_group_name', g.name, 'vendor_id', v.id, 'vendor_name', v.name,
                                 'current_rep_group_id', v.rep_group_id, 'current_rep_group_name', v.other_name, 'sender_id', s.id));
      v_asked := v_asked + 1;
    end if;
  end loop;

  foreach n in array coalesce(p_unknown, '{}') loop
    n := left(trim(n), 120);
    continue when n = '' or exists (select 1 from public.review_items r where r.kind = 'rep_line' and r.organization_id = s.organization_id
                                     and lower(r.details->>'line_name') = lower(n));
    insert into public.review_items (organization_id, kind, entity_type, entity_id, title, details)
    values (s.organization_id, 'rep_line', 'rep_group', g.id,
            format('%s reps %s, which is not one of our vendors. Add it?', g.name, n),
            jsonb_build_object('rep_group_id', g.id, 'rep_group_name', g.name, 'line_name', n, 'sender_id', s.id));
    v_asked := v_asked + 1;
  end loop;

  perform public.rep_group_tag_mail(p_sender);
  return jsonb_build_object('added', to_jsonb(v_added), 'asked', v_asked);
end;
$$;

-- Tag a rep sender's mail to every line of its group the email names; file the ones that name exactly one.
create or replace function public.rep_group_tag_mail(p_sender uuid)
returns void
language plpgsql security definer
set search_path = public
as $$
declare
  s  public.email_senders%rowtype;
  e  record;
begin
  select * into s from public.email_senders where id = p_sender;
  if not found or s.rep_group_id is null then return; end if;
  insert into public.email_vendor_tags (email_id, vendor_id, organization_id, how)
  select em.id, x.id, em.organization_id, 'auto'
    from public.emails em cross join unnest(em.mentioned_vendor_ids) m(vid)
    join public.vendors x on x.id = m.vid and x.rep_group_id = s.rep_group_id and x.is_active
   where em.sender_id = p_sender
  on conflict (email_id, vendor_id) do nothing;
  for e in select id, thread_id from public.emails where sender_id = p_sender and vendor_id is null loop
    perform public.mail_link_email(e.id);
    perform public.mail_refresh_thread(e.thread_id, false);
  end loop;
end;
$$;

-- Claude says an unknown sender is one of our rep groups (gmail-sync, service role).
create or replace function public.mail_apply_sender_rep(p_sender uuid, p_group uuid, p_company text, p_website text, p_phone text, p_note text)
returns text
language plpgsql security definer
set search_path = public
as $$
declare s public.email_senders%rowtype;
begin
  select * into s from public.email_senders where id = p_sender;
  if not found then return 'gone'; end if;
  update public.email_senders set company_name = coalesce(nullif(trim(p_company), ''), company_name),
    company_website = coalesce(nullif(trim(p_website), ''), company_website), company_phone = coalesce(nullif(trim(p_phone), ''), company_phone),
    sorted_at = now(), sort_note = left(p_note, 300)
   where id = p_sender;
  if s.kind <> 'unknown' then return 'info'; end if;
  perform public.rep_group_file_sender(p_sender, p_group, 'Rep group: ' || (select name from public.rep_groups where id = p_group) || ' (Claude)', null);
  return 'rep_group';
end;
$$;

-- Rep group senders whose lines to read (new, or 10 more emails since the last read). Service role only.
create or replace function public.rep_lines_queue(p_org uuid, p_limit integer default 2)
returns table (sender_id uuid, rep_group_id uuid, rep_group_name text)
language sql stable security definer set search_path = public as $$
  select s.id, g.id, g.name from public.email_senders s join public.rep_groups g on g.id = s.rep_group_id
   where s.organization_id = p_org and s.kind = 'rep_group' and s.message_count > 0
     and (s.rep_lines_read_at is null or s.message_count >= coalesce(s.rep_lines_read_count, 0) + 10)
   order by s.rep_lines_read_at nulls first, s.message_count desc
   limit p_limit
$$;

-- A person answers a rep line card: move the vendor to this rep group, keep it, add the line as a vendor, or skip.
create or replace function public.resolve_rep_line(p_item uuid, p_action text)
returns uuid
language plpgsql security definer
set search_path = public
as $$
declare
  r     public.review_items%rowtype;
  v_id  uuid;
  v_grp uuid;
begin
  if not public.user_can_edit() then raise exception 'Only admins, managers and buyers decide rep lines'; end if;
  select * into r from public.review_items where id = p_item for update;
  if not found or not public.user_in_org(r.organization_id) or r.kind <> 'rep_line' then raise exception 'Card not found'; end if;
  if r.status <> 'pending' then return null; end if;
  v_grp := (r.details->>'rep_group_id')::uuid;
  if p_action = 'move' then
    v_id := (r.details->>'vendor_id')::uuid;
    update public.vendors set rep_group_id = v_grp where id = v_id and organization_id = r.organization_id;
  elsif p_action = 'add_vendor' then
    insert into public.vendors (organization_id, name, rep_group_id) values (r.organization_id, r.details->>'line_name', v_grp) returning id into v_id;
  elsif p_action not in ('keep', 'skip') then
    raise exception 'Unknown answer %', p_action;
  end if;
  update public.review_items set status = case when p_action in ('move', 'add_vendor') then 'accepted'::public.review_status else 'rejected'::public.review_status end,
         resolved_by = auth.uid(), resolved_at = now(),
         resolution_note = case p_action when 'move' then 'Moved to ' || (r.details->>'rep_group_name') when 'add_vendor' then 'Added as a vendor'
                                         when 'keep' then 'Kept with ' || coalesce(r.details->>'current_rep_group_name', 'its rep group') else 'Skipped' end
   where id = p_item;
  if v_id is not null and r.details->>'sender_id' is not null then
    perform public.rep_group_tag_mail((r.details->>'sender_id')::uuid);
  end if;
  return v_id;
end;
$$;

revoke execute on function public.rep_group_file_sender(uuid, uuid, text, uuid), public.rep_group_apply_lines(uuid, uuid[], text[]), public.rep_group_tag_mail(uuid),
  public.mail_apply_sender_rep(uuid, uuid, text, text, text, text), public.rep_lines_queue(uuid, integer) from public, anon, authenticated;
grant execute on function public.rep_group_file_sender(uuid, uuid, text, uuid), public.rep_group_apply_lines(uuid, uuid[], text[]), public.rep_group_tag_mail(uuid),
  public.mail_apply_sender_rep(uuid, uuid, text, text, text, text), public.rep_lines_queue(uuid, integer) to service_role;
revoke execute on function public.resolve_rep_line(uuid, text) from public, anon;
grant execute on function public.resolve_rep_line(uuid, text) to authenticated, service_role;

-- Steve Newman at Premier Sales Solutions (pssagency.com), and a fresh look at every "Who is this?" sender with the new rules.
do $$
declare v_s uuid; v_g uuid;
begin
  select id into v_g from public.rep_groups where name = 'Premier Sales Solutions' limit 1;
  select id into v_s from public.email_senders where sender_key = 'pssagency.com' and kind = 'unknown' limit 1;
  if v_g is not null then
    update public.rep_groups set email = coalesce(email, 'steve@pssagency.com'), contact_name = coalesce(contact_name, 'Steve Newman') where id = v_g;
    if v_s is not null then perform public.rep_group_file_sender(v_s, v_g, 'Rep group: Premier Sales Solutions (Steve Newman)', null); end if;
  end if;
end $$;
update public.email_senders set sorted_at = null where kind = 'unknown';
