-- 0228 — Former contacts never file mail (Dana, Oct 22). Claude filed Lauren Marsh (Starlight Toy Group) to DandyLines
-- because a "Lauren Marsh" was listed there. A contact marked former (no longer their rep) no longer files mail to a
-- vendor or a rep group: not by its address (mail_link_email), not by its company domain, not as a known rep group
-- address (mail_match_rep_senders), and not in the rep list Claude reads (gmail-sync). Their old mail stays where it is.

set local lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.mail_link_email(p_email uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  e        public.emails%rowtype;
  s        public.email_senders%rowtype;
  v_addrs  text[];
  v_vendor uuid;
  v_how    text;
  v_ids    uuid[];
begin
  select * into e from public.emails where id = p_email;
  if not found or e.vendor_id is not null then return e.vendor_id is not null; end if;
  v_addrs := case when e.direction = 'in' then array[lower(e.from_email)] else (select array_agg(lower(a)) from unnest(e.to_emails || e.cc_emails) a) end;

  -- 1. the thread already belongs to a vendor
  select th.vendor_id into v_vendor from public.email_threads th where th.id = e.thread_id;
  if v_vendor is not null then v_how := 'thread'; end if;

  -- 2. a known contact address of exactly one vendor
  if v_vendor is null then
    select array_agg(distinct ve.vendor_id) into v_ids
      from public.vendor_emails ve join public.vendors v on v.id = ve.vendor_id and v.is_active
     where ve.organization_id = e.organization_id and lower(ve.email) = any (v_addrs) and ve.former_at is null;
    if cardinality(v_ids) = 1 then v_vendor := v_ids[1]; v_how := 'sender'; end if;
  end if;

  -- 3. what a person said about this sender
  if v_vendor is null and e.sender_id is not null then
    select * into s from public.email_senders where id = e.sender_id;
    if s.kind = 'vendor' then
      v_vendor := s.vendor_id; v_how := 'sender';
    elsif s.kind = 'rep_group' then
      select array_agg(v.id) into v_ids from public.vendors v
       where v.rep_group_id = s.rep_group_id and v.is_active and v.id = any (e.mentioned_vendor_ids);
      if cardinality(v_ids) = 1 then v_vendor := v_ids[1]; v_how := 'rep_group'; end if;
    elsif s.kind in ('platform', 'carrier') then
      -- NetSuite, Bill.com, FashionGo…, and freight carriers: mail for many vendors; the email itself has to
      -- name exactly one (Pinnacle about the Stansport PO shows on Stansport too).
      select array_agg(v.id) into v_ids from public.vendors v where v.is_active and v.id = any (e.mentioned_vendor_ids);
      if cardinality(v_ids) = 1 then v_vendor := v_ids[1]; v_how := 'platform'; end if;
    end if;
  end if;

  -- 4. same company domain as exactly one vendor's known contact (never free mail, never ours, and never
  --    for a sender that writes about many vendors: Worldwide's newsletters are not Worldwide Warehouse's)
  if v_vendor is null and not exists (select 1 from public.email_senders x where x.id = e.sender_id and x.kind in ('platform', 'carrier', 'marketing', 'not_vendor')) then
    select array_agg(distinct ve.vendor_id) into v_ids
      from public.vendor_emails ve join public.vendors v on v.id = ve.vendor_id and v.is_active
     where ve.organization_id = e.organization_id and ve.former_at is null
       and public.mail_domain(ve.email) = any (select public.mail_domain(a) from unnest(v_addrs) a)
       and not public.mail_is_freemail(public.mail_domain(ve.email))
       and not (public.mail_domain(ve.email) = any (coalesce((select internal_domains from public.mail_accounts where organization_id = e.organization_id), '{}')));
    if cardinality(v_ids) = 1 then v_vendor := v_ids[1]; v_how := 'domain'; end if;
  end if;

  if v_vendor is null then return false; end if;
  update public.emails set vendor_id = v_vendor, match_how = v_how where id = p_email;
  return true;
end;
$function$;

CREATE OR REPLACE FUNCTION public.mail_match_rep_senders(p_org uuid, p_sender_ids uuid[] DEFAULT NULL::uuid[])
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  r        record;
  v_count  integer := 0;
begin
  for r in
    with addrs as (
      select g.id as rep_group_id, g.name, lower(trim(g.email)) as email from public.rep_groups g where g.organization_id = p_org and g.is_active and g.email is not null
      union
      select g.id, g.name, lower(trim(c.email)) from public.rep_group_contacts c join public.rep_groups g on g.id = c.rep_group_id
       where g.organization_id = p_org and g.is_active and c.email is not null and c.former_at is null
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
$function$;
