-- 0042 — The company-domain rule no longer files mail from many-vendor senders: once Worldwide Warehouse had
-- Worldwide's warehouse address, every worldwidebuygroup.com newsletter matched it by domain.
create or replace function public.mail_link_email(p_email uuid)
returns boolean
language plpgsql security definer
set search_path = public
as $$
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
     where ve.organization_id = e.organization_id and lower(ve.email) = any (v_addrs);
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
     where ve.organization_id = e.organization_id
       and public.mail_domain(ve.email) = any (select public.mail_domain(a) from unnest(v_addrs) a)
       and not public.mail_is_freemail(public.mail_domain(ve.email))
       and not (public.mail_domain(ve.email) = any (coalesce((select internal_domains from public.mail_accounts where organization_id = e.organization_id), '{}')));
    if cardinality(v_ids) = 1 then v_vendor := v_ids[1]; v_how := 'domain'; end if;
  end if;

  if v_vendor is null then return false; end if;
  update public.emails set vendor_id = v_vendor, match_how = v_how where id = p_email;
  return true;
end;
$$;

do $$ declare r record; begin
  for r in select e.id, e.thread_id from public.emails e join public.email_senders s on s.id = e.sender_id
            where s.kind in ('platform', 'carrier', 'marketing', 'not_vendor') and e.match_how = 'domain' loop
    update public.emails set vendor_id = null, match_how = null where id = r.id;
    perform public.mail_link_email(r.id);
  end loop;
  for r in select t.id from public.email_threads t
            where t.vendor_id is not null and not exists (select 1 from public.emails e where e.thread_id = t.id and e.vendor_id = t.vendor_id) loop
    update public.email_threads set vendor_id = null where id = r.id;
    perform public.mail_refresh_thread(r.id, true);
  end loop;
end $$;
