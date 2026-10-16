-- 0115 — Accounting contacts: one company per registrable domain. The first pass over billing@ (Oct 16) split
-- bill.com from inform.bill.com, verizonwireless.com from its two mailing subdomains and sce.com from message.sce.com.
-- Company keys are now the last two labels of the domain (bill.com); matching an address at any subdomain finds the
-- company. Addresses are still matched exactly first.

create or replace function public.accounting_company_domain(p_email_or_domain text) returns text
language sql immutable as $$
  select case when d = '' then null
              when array_length(parts, 1) <= 2 then d
              else parts[array_length(parts, 1) - 1] || '.' || parts[array_length(parts, 1)] end
    from (select lower(split_part(coalesce(p_email_or_domain, ''), '@', case when position('@' in coalesce(p_email_or_domain, '')) > 0 then 2 else 1 end)) as d) x,
         lateral (select string_to_array(x.d, '.') as parts) y
$$;

create or replace function public.accounting_contact_for(p_org uuid, p_email text) returns uuid
language sql stable security definer set search_path = public as $$
  select coalesce(
    (select a.contact_id from public.accounting_contact_addresses a join public.accounting_contacts c on c.id = a.contact_id
      where a.organization_id = p_org and not a.is_domain and a.address = lower(p_email) and c.status <> 'ignored' and c.merged_into is null limit 1),
    (select a.contact_id from public.accounting_contact_addresses a join public.accounting_contacts c on c.id = a.contact_id
      where a.organization_id = p_org and a.is_domain and a.address in (split_part(lower(p_email), '@', 2), public.accounting_company_domain(p_email))
        and c.status <> 'ignored' and c.merged_into is null
      order by a.address = split_part(lower(p_email), '@', 2) desc limit 1))
$$;

create or replace function public.accounting_propose_contacts(p_org uuid) returns integer
language plpgsql security definer set search_path = public as $$
declare n integer := 0; r record; v_id uuid; v_company text; v_person text;
begin
  if auth.uid() is not null and not public.sees_accounting() then raise exception 'Accounting only' using errcode = '42501'; end if;
  for r in
    with mail as (
      select lower(e.from_email) as email, nullif(trim(e.from_name), '') as name, e.received_at, coalesce(e.is_bulk, false) as is_bulk
        from public.emails e join public.mailboxes m on m.id = e.mailbox_id and m.kind = 'accounting'
       where e.organization_id = p_org and e.direction = 'in' and e.from_email is not null and e.copy_of is null
      union all
      select lower(t), null, e.received_at, false
        from public.emails e join public.mailboxes m on m.id = e.mailbox_id and m.kind = 'accounting'
        cross join lateral unnest(e.to_emails) t
       where e.organization_id = p_org and e.direction = 'out' and e.copy_of is null
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
           mode() within group (order by name) filter (where name !~ '^[A-Z][a-z''-]+( [A-Z]\.?)? [A-Z][A-Za-z''-]+$' and name !~* '@|noreply|no-reply|do not reply|notification') as company_name
      from keyed
     where key is not null
     group by key
    having count(*) >= 2 and not bool_and(is_bulk)
       and not exists (select 1 from public.accounting_contact_addresses a where a.organization_id = p_org and a.address = keyed.key)
  loop
    v_company := coalesce(r.company_name, case when r.is_domain then initcap(replace(split_part(r.key, '.', 1), '-', ' ')) else '' end);
    v_person := coalesce(r.person_name, '');
    insert into public.accounting_contacts (organization_id, company, person, message_count, last_contact_at)
      values (p_org, v_company, v_person, r.n, r.last_at) returning id into v_id;
    insert into public.accounting_contact_addresses (organization_id, address, is_domain, contact_id) values (p_org, r.key, r.is_domain, v_id) on conflict do nothing;
    if r.is_domain then
      insert into public.accounting_contact_addresses (organization_id, address, is_domain, contact_id)
        select p_org, x, false, v_id from unnest(r.emails) x on conflict do nothing;
    end if;
    n := n + 1;
  end loop;
  if n > 0 then perform public.accounting_rematch_all(p_org); end if;
  return n;
end;
$$;

revoke execute on function public.accounting_company_domain(text) from public, anon;
grant execute on function public.accounting_company_domain(text) to authenticated, service_role;
