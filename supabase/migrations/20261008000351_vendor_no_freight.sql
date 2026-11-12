-- Vendors who pay the freight and ship it themselves (Dana, Nov 12: "We do not pay freight on snopark passes. The state
-- pays and ships FedEx. We dont need Any reference to freight on sp"). vendors.no_freight: no freight boxes on the vendor
-- or order pages, no shipment details email, no routing letter, orders carry free freight from the start.
alter table public.vendors add column if not exists no_freight boolean not null default false;
comment on column public.vendors.no_freight is 'They pay the freight and ship it (the State of California for Sno-Park): no freight anywhere in VMS for them.';

-- a shipment details request for such a vendor is skipped the moment it is made
create or replace function public.shipment_requests_no_freight() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if exists (select 1 from public.vendors v where v.id = new.vendor_id and v.no_freight) and new.status <> 'skipped' then
    new.status := 'skipped'; new.hold := false; new.skip_reason := 'They pay the freight and ship it; no freight in VMS for this vendor.';
  end if;
  return new;
end $$;
drop trigger if exists shipment_requests_no_freight on public.shipment_requests;
create trigger shipment_requests_no_freight before insert on public.shipment_requests for each row execute function public.shipment_requests_no_freight();

-- their orders are free freight from the start
create or replace function public.orders_no_freight() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.vendor_id is not null and exists (select 1 from public.vendors v where v.id = new.vendor_id and v.no_freight) then
    new.freight_terms := 'free'; new.freight_terms_source := coalesce(new.freight_terms_source, 'person'); new.free_shipping := true; new.free_shipping_basis := coalesce(new.free_shipping_basis, 'always');
    new.freight_terms_confirmed_at := coalesce(new.freight_terms_confirmed_at, now()); new.freight_terms_confirmed_how := coalesce(new.freight_terms_confirmed_how, 'person');
  end if;
  return new;
end $$;
drop trigger if exists orders_no_freight on public.orders;
create trigger orders_no_freight before insert or update of vendor_id on public.orders for each row execute function public.orders_no_freight();

-- no routing letter asked of them
create or replace function public.routing_letter_missing(p_org uuid, p_who text)
returns table (vendor_id uuid, vendor_name text, open_orders integer)
language sql stable security definer set search_path = public as $$
  select v.id, v.name, (select count(*)::integer from public.orders o where o.vendor_id = v.id and o.status in ('open', 'awaiting_confirmation', 'confirmed'))
    from public.vendors v
   where v.organization_id = p_org and public.user_in_org(p_org) and v.is_active and v.merged_into_id is null and not v.web_orders and not v.no_freight
     and case p_who when 'open_orders' then exists (select 1 from public.orders o where o.vendor_id = v.id and o.status in ('open', 'awaiting_confirmation', 'confirmed'))
                    when 'all' then exists (select 1 from public.orders o where o.vendor_id = v.id) else false end
     and not exists (select 1 from public.routing_recipients(v.id))
   order by v.name
$$;

-- CA Sno-Park: the State pays and ships FedEx
do $$ declare v_id uuid; begin
  for v_id in select id from public.vendors where upper(name) like '%SNO%PARK%' and merged_into_id is null loop
    update public.vendors set no_freight = true where id = v_id;
    update public.orders set freight_terms = 'free', freight_terms_source = coalesce(freight_terms_source, 'person'), free_shipping = true, free_shipping_basis = coalesce(free_shipping_basis, 'always'),
           freight_terms_confirmed_at = coalesce(freight_terms_confirmed_at, now()), freight_terms_confirmed_how = coalesce(freight_terms_confirmed_how, 'person')
     where vendor_id = v_id and status not in ('cancelled');
    update public.shipment_requests set status = 'skipped', hold = false, skip_reason = 'They pay the freight and ship it; no freight in VMS for this vendor.' where vendor_id = v_id and status in ('ready', 'waiting');
    update public.tasks set done_at = now(), closed_how = 'mistake', remind_at = null, done_note = 'The State pays the freight and ships Sno-Park books itself; no freight work for this vendor (Dana, Nov 12).'
     where vendor_id = v_id and done_at is null and (auto_key like 'shipreq%' or auto_key like 'shipsend:%' or auto_key like 'shipcheck:%' or auto_key like 'fqask:%' or auto_key like 'freightissue:%' or auto_key like 'routing%');
  end loop;
end $$;
