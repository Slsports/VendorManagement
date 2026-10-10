-- 0058 — Billing companies vs trucking companies (Dana, Oct 9). We book and pay Priority One, PartnerShip,
-- Worldwide Express (WWEX / ShipStation), UPS DIRECT and Worldwide Distributors (WWD); XPO and Oak Harbor
-- Freight only haul, hired by one of them. Bills belong to billing companies. WWD is a billing company too:
-- its freight bills come through the WWD portal (Trevor uploads them), and mail from anyone in the WWD
-- directory's Warehouse department (warehouse@, Sue…) is WWD freight mail, still filed to its vendors.
alter table public.carriers add column if not exists role text not null default 'billing' check (role in ('billing', 'trucking'));
alter table public.carriers add column if not exists hired_by text;
alter table public.carriers add column if not exists partner_id uuid references public.partners(id) on delete set null;
alter table public.carriers add column if not exists partner_department text;
comment on column public.carriers.role is 'billing: we book and pay them; trucking: hauls the freight, hired by a billing company.';
comment on column public.carriers.partner_department is 'Mail from this department of the partner''s directory (WWD Warehouse) is this carrier''s freight mail.';

update public.carriers set role = 'trucking', hired_by = 'Worldwide Distributors, PartnerShip' where name = 'XPO';
update public.carriers set role = 'trucking', hired_by = 'Priority One' where name = 'Oak Harbor Freight';

insert into public.carriers (organization_id, name, mode, role, email_domains, partner_id, partner_department, owner_id, notes)
select o.id, 'Worldwide Distributors (WWD)', 'ltl', 'billing', array['warehouse@worldwidebuygroup.com'],
       (select p.id from public.partners p where p.organization_id = o.id and p.name ilike 'Worldwide Distributors%' limit 1), 'Warehouse',
       (select owner_id from public.carriers c where c.organization_id = o.id and c.name = 'PartnerShip'),
       'WWD ships pallets to us, often by XPO; its freight bills drop into the WWD portal (Trevor uploads them, a few per buying season).'
  from public.organizations o
 where exists (select 1 from public.mail_accounts m where m.organization_id = o.id)
on conflict (organization_id, name) do nothing;

-- The billing company whose directory department (or address) wrote this email.
create or replace function public.mail_partner_carrier(p_org uuid, p_from text)
returns uuid language sql stable security definer set search_path = public as $$
  select c.id from public.carriers c
   where c.organization_id = p_org and c.is_active
     and (lower(p_from) = any (select lower(d) from unnest(c.email_domains) d where d like '%@%')
          or (c.partner_id is not null and exists (select 1 from public.partner_contacts pc
               where pc.partner_id = c.partner_id and pc.is_active and lower(pc.email) = lower(p_from)
                 and lower(coalesce(pc.department, '')) = lower(coalesce(c.partner_department, '')))))
   order by c.name limit 1
$$;

-- Freight threads: the sender's carrier, or the partner department's (WWD Warehouse).
create or replace function public.emails_mark_carrier()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_carrier uuid;
begin
  if exists (select 1 from public.email_senders s where s.id = new.sender_id and s.kind = 'carrier') then
    perform public.mail_mark_carrier_thread(new.thread_id);
  elsif new.direction = 'in' then
    v_carrier := public.mail_partner_carrier(new.organization_id, new.from_email);
    if v_carrier is not null then
      update public.email_threads set carrier_id = v_carrier where id = new.thread_id and carrier_id is null;
    end if;
  end if;
  return null;
end;
$$;

update public.email_threads t set carrier_id = x.cid
  from (select distinct on (e.thread_id) e.thread_id, public.mail_partner_carrier(e.organization_id, e.from_email) as cid
          from public.emails e where e.direction = 'in' order by e.thread_id, e.received_at) x
 where x.thread_id = t.id and x.cid is not null and t.carrier_id is null;
