-- 0099 — Other freight companies (Dana, Oct 12): carriers we have no account with (FedEx, USPS, UPS tracking,
-- Cainiao, Speedco…) are listed at the bottom of the Freight page, and their mail is freight mail for Trevor
-- ("He receives all the orders so it's good for him to see what we have coming"). Claude adds new ones it finds
-- when it sorts unknown senders, instead of a "Who is this?" card.

alter table public.carriers drop constraint if exists carriers_role_check;
alter table public.carriers add constraint carriers_role_check check (role in ('billing', 'trucking', 'other'));
comment on column public.carriers.role is 'billing: we book and pay them; trucking: hauls the freight, hired by a billing company; other: a freight company we have no account with whose mail (tracking, delivery notices) we get.';

-- Make (or find) an "other" freight company for a sender and file the sender to it. No permission check: callers check.
create or replace function public.mail_sender_to_freight(p_sender uuid, p_name text)
returns uuid
language plpgsql security definer
set search_path = public
as $$
declare
  s       public.email_senders%rowtype;
  v_id    uuid;
  v_dom   text;
  v_owner uuid;
  r       record;
begin
  select * into s from public.email_senders where id = p_sender for update;
  if not found then return null; end if;
  v_dom := case when s.is_domain then s.sender_key else split_part(s.sender_key, '@', 2) end;
  v_dom := substring(v_dom from '([^.]+\.[^.]+)$');  -- tracking.usps.com → usps.com
  v_id := public.mail_carrier_for(s.organization_id, s.sender_key);
  if v_id is null then
    select id into v_id from public.carriers where organization_id = s.organization_id and lower(name) = lower(trim(p_name));
  end if;
  if v_id is null then
    -- Trevor: whoever owns the billing companies' mail
    select owner_id into v_owner from public.carriers where organization_id = s.organization_id and role = 'billing' and owner_id is not null order by created_at limit 1;
    insert into public.carriers (organization_id, name, mode, role, email_domains, owner_id, notes)
    values (s.organization_id, coalesce(nullif(trim(p_name), ''), v_dom), 'parcel', 'other', array[v_dom], v_owner, 'Added from the mail: no account with them.')
    returning id into v_id;
  elsif v_dom <> '' and not exists (select 1 from public.carriers where id = v_id and (v_dom = any (email_domains) or exists (select 1 from unnest(email_domains) d where v_dom like '%.' || d))) then
    update public.carriers set email_domains = email_domains || v_dom where id = v_id;
  end if;

  update public.email_senders set kind = 'carrier', carrier_id = v_id, vendor_id = null, rep_group_id = null,
         view_rule = null, decided_at = now(), sorted_at = coalesce(sorted_at, now())
   where id = p_sender;
  update public.review_items set status = 'accepted', resolved_at = now(), resolution_note = 'Freight company: ' || (select name from public.carriers where id = v_id)
   where id = s.review_item_id and status = 'pending';
  select owner_id into v_owner from public.carriers where id = v_id;
  for r in select distinct thread_id from public.emails where sender_id = p_sender loop
    perform public.mail_mark_carrier_thread(r.thread_id);
    -- conversations handed to the admin when this sender was "Other" go to the freight owner
    if s.kind = 'not_vendor' and v_owner is not null then
      update public.email_threads t set owner_id = v_owner, owner_set_at = now()
       where t.id = r.thread_id and t.owner_id in (select id from public.profiles where role = 'admin')
         and not exists (select 1 from public.emails e where e.thread_id = t.id and e.direction = 'out');
    end if;
  end loop;
  perform public.mail_classify(s.organization_id, (select array_agg(id) from public.emails where sender_id = p_sender));
  return v_id;
end;
$$;
revoke execute on function public.mail_sender_to_freight(uuid, text) from public, anon, authenticated;
grant execute on function public.mail_sender_to_freight(uuid, text) to service_role;

-- Claude's sender sort can now answer "carrier": a freight company joins Other freight companies.
create or replace function public.mail_apply_sender_sort(p_sender uuid, p_decision text, p_vendor uuid, p_company text, p_website text, p_phone text, p_note text)
returns text
language plpgsql security definer
set search_path = public
as $$
declare s public.email_senders%rowtype;
begin
  select * into s from public.email_senders where id = p_sender for update;
  if not found then return 'gone'; end if;
  update public.email_senders set company_name = coalesce(nullif(trim(p_company), ''), company_name),
    company_website = coalesce(nullif(trim(p_website), ''), company_website), company_phone = coalesce(nullif(trim(p_phone), ''), company_phone),
    sorted_at = now(), sort_note = left(p_note, 300)
   where id = p_sender;
  if s.kind <> 'unknown' then return 'info'; end if;

  if p_decision = 'vendor' and p_vendor is not null
     and exists (select 1 from public.vendors where id = p_vendor and organization_id = s.organization_id and is_active and merged_into_id is null) then
    perform public.mail_file_sender(p_sender, p_vendor, 'claude', p_note, null);
    return 'filed';
  elsif p_decision = 'carrier' then
    perform public.mail_sender_to_freight(p_sender, coalesce(nullif(trim(p_company), ''), s.display_name, s.sender_key));
    return 'carrier';
  elsif p_decision = 'never_bought' then
    update public.email_senders set kind = 'marketing', view_rule = 'offers', decided_at = now() where id = p_sender;
    update public.review_items set status = 'rejected', resolved_at = now(), resolution_note = 'Never bought from (Claude)'
     where id = s.review_item_id and status = 'pending';
    perform public.mail_classify(s.organization_id, (select array_agg(id) from public.emails where sender_id = p_sender));
    return 'never_bought';
  end if;
  update public.email_senders set ai_note = coalesce(left(p_note, 300), ai_note), ai_read_at = coalesce(ai_read_at, now()) where id = p_sender;
  return 'unsure';
end;
$$;

-- The carriers already in the mail that were marked "Other" this morning.
do $$
declare r record;
begin
  for r in select s.id, x.name from public.email_senders s
             join (values ('fedex.com', 'FedEx'), ('tracking.usps.com', 'USPS'), ('ups.com', 'UPS'),
                          ('service-experience.cainiao.com', 'Cainiao'), ('speedcologistics.com', 'Speedco Logistics')) x(key, name)
               on x.key = s.sender_key
            where s.kind in ('not_vendor', 'unknown') loop
    perform public.mail_sender_to_freight(r.id, r.name);
  end loop;
end $$;
