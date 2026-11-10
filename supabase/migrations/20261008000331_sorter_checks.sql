-- Two sorter checks (Dana, Nov 10, "go"), after a former employee (Mia Burton) was sorted as a rep from one old email and the
-- Bill.com accounting contact was named after a payee (John Burton):
-- 1. The sender sorter can answer "staff": a person whose mail with us is time cards, schedules, shifts, Paychex, job
--    applications or pay is our own staff, past or present, never a vendor or rep. Stored as kind "internal", no card.
-- 2. The accounting contact proposer gives a contact a person's name only when most of that address's mail carries it; a
--    service relaying for many people (Bill.com) gets the company alone. Back-check: proposed contacts whose person came
--    from a minority of their mail lose the name.

create or replace function public.mail_apply_sender_sort(p_sender uuid, p_decision text, p_vendor uuid, p_company text, p_website text, p_phone text, p_note text, p_people jsonb default null)
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
    rep_contacts = case when jsonb_typeof(p_people) = 'array' and jsonb_array_length(p_people) > 0 then p_people else rep_contacts end,
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
  elsif p_decision = 'staff' then
    -- our own people, past or present (Dana, Nov 10: a former employee had been sorted as a rep from one old email)
    update public.email_senders set kind = 'internal', decided_at = now() where id = p_sender;
    update public.review_items set status = 'rejected', resolved_at = now(), resolution_note = 'Our staff, past or present (Claude)'
     where id = s.review_item_id and status = 'pending';
    perform public.mail_classify(s.organization_id, (select array_agg(id) from public.emails where sender_id = p_sender));
    return 'staff';
  elsif p_decision = 'never_bought' then
    update public.email_senders set kind = 'marketing', view_rule = 'offers', decided_at = now() where id = p_sender;
    update public.review_items set status = 'rejected', resolved_at = now(), resolution_note = 'Never bought from (Claude)'
     where id = s.review_item_id and status = 'pending';
    perform public.mail_classify(s.organization_id, (select array_agg(id) from public.emails where sender_id = p_sender));
    return 'never_bought';
  end if;
  -- a rep agency not in Rep Groups, or a service for many vendors: the card says so; a person decides
  update public.email_senders set ai_note = coalesce(left(p_note, 300), ai_note), ai_read_at = coalesce(ai_read_at, now()),
         ai_kind = case p_decision when 'rep_group' then 'rep_group' when 'platform' then 'platform' else ai_kind end
   where id = p_sender;
  perform public.mail_refresh_sender(p_sender);
  return 'unsure';
end;
$$;

create or replace function public.accounting_propose_contacts(p_org uuid)
returns integer language plpgsql security definer set search_path = public as $$
declare n integer := 0; r record; v_id uuid; v_company text; v_person text;
        v_now timestamptz := now(); v_since timestamptz; v_cand text[]; v_like text[]; v_keys text[] := '{}';
begin
  if auth.uid() is not null and not (public.sees_accounting() and public.user_in_org(p_org)) then raise exception 'Accounting only' using errcode = '42501'; end if;
  select checked_to - interval '10 minutes' into v_since from public.accounting_propose_state where organization_id = p_org;

  -- addresses in the new mail that are not on a contact yet (on the first run: all the mail)
  with addrs as (
    select distinct lower(e.from_email) as email
      from public.emails e join public.mailboxes m on m.id = e.mailbox_id and m.kind = 'accounting'
     where e.organization_id = p_org and e.direction = 'in' and e.from_email is not null and e.copy_of is null and (v_since is null or e.created_at > v_since)
    union
    select distinct lower(t)
      from public.emails e join public.mailboxes m on m.id = e.mailbox_id and m.kind = 'accounting'
      cross join lateral unnest(e.to_emails) t
     where e.organization_id = p_org and e.direction = 'out' and e.copy_of is null and (v_since is null or e.created_at > v_since)
  ), keyed as (
    select case when public.accounting_freemail(split_part(email, '@', 2)) then email else public.accounting_company_domain(email) end as key
      from addrs
     where email like '%@%' and not public.accounting_our_address(p_org, email)
       and split_part(email, '@', 1) not in ('mailer-daemon', 'postmaster')
  )
  select array_agg(distinct key) into v_cand from keyed k
   where key is not null and not exists (select 1 from public.accounting_contact_addresses a where a.organization_id = p_org and a.address = k.key);

  insert into public.accounting_propose_state (organization_id, checked_to) values (p_org, v_now)
    on conflict (organization_id) do update set checked_to = excluded.checked_to;
  if v_cand is null then return 0; end if;
  v_like := coalesce(array(select '%.' || k from unnest(v_cand) k where position('@' in k) = 0), '{}');

  for r in
    with mail as (
      select lower(e.from_email) as email, nullif(trim(e.from_name), '') as name, e.received_at, coalesce(e.is_bulk, false) as is_bulk
        from public.emails e join public.mailboxes m on m.id = e.mailbox_id and m.kind = 'accounting'
       where e.organization_id = p_org and e.direction = 'in' and e.from_email is not null and e.copy_of is null
         and (lower(e.from_email) = any (v_cand) or split_part(lower(e.from_email), '@', 2) = any (v_cand) or split_part(lower(e.from_email), '@', 2) like any (v_like))
      union all
      select lower(t), null, e.received_at, false
        from public.emails e join public.mailboxes m on m.id = e.mailbox_id and m.kind = 'accounting'
        cross join lateral unnest(e.to_emails) t
       where e.organization_id = p_org and e.direction = 'out' and e.copy_of is null
         and (lower(t) = any (v_cand) or split_part(lower(t), '@', 2) = any (v_cand) or split_part(lower(t), '@', 2) like any (v_like))
    ), keyed as (
      select case when public.accounting_freemail(split_part(email, '@', 2)) then email else public.accounting_company_domain(email) end as key,
             not public.accounting_freemail(split_part(email, '@', 2)) as is_domain, email, name, received_at, is_bulk
        from mail
       where email like '%@%' and not public.accounting_our_address(p_org, email)
         and split_part(email, '@', 1) not in ('mailer-daemon', 'postmaster')
    )
    select key, bool_or(is_domain) as is_domain, count(*) as n, max(received_at) as last_at, bool_and(is_bulk) as all_bulk,
           array_agg(distinct email) as emails,
           mode() within group (order by name) filter (where name ~ '^[A-Z][a-z''-]+( [A-Z]\.?)? [A-Z][A-Za-z''-]+$') as person_name,
           count(*) filter (where name ~ '^[A-Z][a-z''-]+( [A-Z]\.?)? [A-Z][A-Za-z''-]+$') as person_n,
           mode() within group (order by name) filter (where name !~ '^[A-Z][a-z''-]+( [A-Z]\.?)? [A-Z][A-Za-z''-]+$' and name !~* '@|noreply|no-reply|do not reply|notification') as company_name
      from keyed
     where key = any (v_cand)
     group by key
    having count(*) >= 2 and not bool_and(is_bulk)
       and not exists (select 1 from public.accounting_contact_addresses a where a.organization_id = p_org and a.address = keyed.key)
  loop
    v_company := coalesce(r.company_name, case when r.is_domain then initcap(replace(split_part(r.key, '.', 1), '-', ' ')) else '' end);
    -- a person's name only when most of the mail carries it (Dana, Nov 10): a service that relays for many people
    -- (Bill.com's notices carried the payee John Burton's name) gets no person
    v_person := case when r.person_n * 2 >= r.n then coalesce(r.person_name, '') else '' end;
    insert into public.accounting_contacts (organization_id, company, person, message_count, last_contact_at)
      values (p_org, v_company, v_person, r.n, r.last_at) returning id into v_id;
    insert into public.accounting_contact_addresses (organization_id, address, is_domain, contact_id) values (p_org, r.key, r.is_domain, v_id) on conflict do nothing;
    if r.is_domain then
      insert into public.accounting_contact_addresses (organization_id, address, is_domain, contact_id)
        select p_org, x, false, v_id from unnest(r.emails) x on conflict do nothing;
    end if;
    v_keys := v_keys || r.key || r.emails;
    n := n + 1;
  end loop;
  if n > 0 then perform public.accounting_rematch_keys(p_org, v_keys); end if;
  return n;
end;
$$;

-- ---- back-check: person names that most of the contact's mail does not carry ----------------------------------------
do $$ declare n integer; begin
  with c as (
    select ct.id, ct.organization_id from public.accounting_contacts ct where ct.status = 'proposed' and coalesce(ct.person, '') <> '' and ct.merged_into is null
  ), m as (
    select c.id, count(*) as n,
           count(*) filter (where e.from_name ~ '^[A-Z][a-z''-]+( [A-Z]\.?)? [A-Z][A-Za-z''-]+$') as person_n
      from c
      join public.accounting_contact_addresses a on a.contact_id = c.id
      join public.emails e on e.organization_id = c.organization_id and e.direction = 'in' and e.copy_of is null
       and (lower(e.from_email) = a.address or (a.is_domain and split_part(lower(e.from_email), '@', 2) = a.address))
     group by c.id
  )
  update public.accounting_contacts ct set person = ''
    from m where m.id = ct.id and m.person_n * 2 < m.n;
  get diagnostics n = row_count;
  raise notice 'accounting contacts whose person name was dropped: %', n;
end $$;
