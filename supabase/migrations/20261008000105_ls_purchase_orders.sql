-- 0105 — One PO number, made by VMS, created in Lightspeed (Dana, Oct 13: "We always try to use only one PO … Simplicity
-- is best"; "I like our custom PO naming convention because it immediately tells us the vendor and the date we ordered:
-- [Vendor][order date]", e.g. YAKIMA080626). Trevor keeps it in the LS PO's Reference # field; LS's own PO number is only
-- kept by VMS to find the PO again.
-- • Each vendor has a PO code (starts from its name; editable) and its Lightspeed vendor (matched by name, else picked).
-- • "Create PO in LS" makes the empty PO in LS for the vendor and store, Reference # = our PO; the PO goes on the order,
--   which drafts the email asking the vendor to put it on their order and closes the Create PO task.
-- • After the confirmation, the approved LS PO draft adds its items to that same PO in LS ("Send to LS").

alter table public.vendors add column if not exists po_code text;
comment on column public.vendors.po_code is 'The vendor part of our PO numbers: YAKIMA in YAKIMA080626 (Dana, Oct 13).';
comment on column public.vendors.lightspeed_vendor_id is 'This vendor in Lightspeed (Vendor.vendorID), matched by lightspeed_name or picked.';
alter table public.orders add column if not exists ls_order_id text;
alter table public.orders add column if not exists ls_shop_id text;
comment on column public.orders.ls_order_id is 'LS''s own number for the PO (Order.orderID), kept only to find it; our PO is po_number (Reference # in LS).';
alter table public.stores add column if not exists ls_shop_id text;
update public.stores set ls_shop_id = case code when 'SLS' then '3' when 'SLM' then '1' when 'GS' then '2' end where ls_shop_id is null and code in ('SLS', 'SLM', 'GS');

-- Lightspeed's vendors, for matching and the picker (refreshed from LS).
create table if not exists public.ls_vendors (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  ls_vendor_id    text not null,
  name            text not null,
  archived        boolean not null default false,
  synced_at       timestamptz not null default now(),
  primary key (organization_id, ls_vendor_id)
);
alter table public.ls_vendors enable row level security;
drop policy if exists "ls_vendors: members read" on public.ls_vendors;
create policy "ls_vendors: members read" on public.ls_vendors for select to authenticated using (public.user_in_org(organization_id));
grant select on table public.ls_vendors to authenticated;
grant all on table public.ls_vendors to service_role;

-- "YAKIMA - WWD", "KIDGALAXY WWD", "IMPLUS (WWD)", "AQUA CASE - FAIRE & WWD" → the vendor's own name, for matching.
create or replace function public.ls_vendor_key(p_name text) returns text language sql immutable as $$
  select regexp_replace(lower(regexp_replace(regexp_replace(coalesce(p_name, ''),
           '\s*[-(]?\s*\(?\s*(faire\s*&\s*)?(wwd|faire)\s*\)?\s*$', '', 'i'),
           '\m(inc|llc|co|corp|company|ltd|the)\M\.?', '', 'gi')), '[^a-z0-9]', '', 'g')
$$;

-- The PO code from a vendor name: the name squeezed together (KELLIS, SHARKEYES) when short, else its first word.
create or replace function public.po_code_default(p_name text) returns text language sql immutable as $$
  with n as (select upper(regexp_replace(regexp_replace(coalesce(p_name, ''), '\s*[-(]\s*(wwd|faire).*$', '', 'i'), '[^A-Za-z0-9 ]', '', 'g')) as s)
  select case when length(replace(s, ' ', '')) <= 12 then replace(s, ' ', '')
              when length(split_part(trim(s), ' ', 1)) >= 4 then split_part(trim(s), ' ', 1)
              else left(replace(s, ' ', ''), 12) end
    from n
$$;
grant execute on function public.ls_vendor_key(text), public.po_code_default(text) to authenticated, service_role;

-- Our next PO for an order: code + order date as MMDDYY; a second order to the vendor that day gets -2, then -3 …
create or replace function public.po_number_next(p_order uuid) returns text
language plpgsql stable security definer set search_path = public as $$
declare
  o    public.orders%rowtype;
  base text;
  n    integer := 1;
  cand text;
begin
  select * into o from public.orders where id = p_order;
  if o.id is null then return null; end if;
  select coalesce(nullif(trim(v.po_code), ''), public.po_code_default(v.name)) || to_char(coalesce(o.order_date, current_date), 'MMDDYY')
    into base from public.vendors v where v.id = o.vendor_id;
  cand := base;
  while exists (select 1 from public.orders x where x.organization_id = o.organization_id and x.id <> o.id and upper(x.po_number) = upper(cand)) loop
    n := n + 1;
    cand := base || '-' || n;
  end loop;
  return cand;
end;
$$;
revoke execute on function public.po_number_next(uuid) from public, anon;
grant execute on function public.po_number_next(uuid) to authenticated, service_role;

-- Match VMS vendors to LS vendors (after a refresh from LS): the LS name on file exactly (764 vendors carry it from the
-- LS export), else the name without "- WWD" and the like, where exactly one fits. Returns how many matched.
create or replace function public.ls_vendors_match(p_org uuid) returns integer
language plpgsql security definer set search_path = public as $$
declare n integer; m integer;
begin
  with exact as (
    select lower(trim(name)) k, min(ls_vendor_id) id, count(*) c from public.ls_vendors where organization_id = p_org group by 1
  )
  update public.vendors v set lightspeed_vendor_id = e.id from exact e
   where v.organization_id = p_org and v.lightspeed_vendor_id is null and v.merged_into_id is null and e.c = 1 and e.k = lower(trim(v.lightspeed_name));
  get diagnostics n = row_count;
  with keys as (
    select public.ls_vendor_key(name) k, min(ls_vendor_id) id, min(name) nm, count(*) c from public.ls_vendors where organization_id = p_org and not archived group by 1
  ), hits as (
    select v.id vid, k.id lsid, k.nm from public.vendors v join keys k on k.c = 1 and k.k <> '' and k.k in (public.ls_vendor_key(v.name), public.ls_vendor_key(v.lightspeed_name))
     where v.organization_id = p_org and v.lightspeed_vendor_id is null and v.merged_into_id is null
  )
  update public.vendors v set lightspeed_vendor_id = h.lsid, lightspeed_name = coalesce(v.lightspeed_name, h.nm) from hits h where v.id = h.vid;
  get diagnostics m = row_count;
  return n + m;
end;
$$;
revoke execute on function public.ls_vendors_match(uuid) from public, anon, authenticated;
grant execute on function public.ls_vendors_match(uuid) to service_role;

-- The vendor page's "PO code" and "In Lightspeed as" (editors).
create or replace function public.vendor_set_ls(p_vendor uuid, p_ls_vendor_id text, p_po_code text)
returns void language plpgsql security definer set search_path = public as $$
declare v public.vendors%rowtype;
begin
  select * into v from public.vendors where id = p_vendor;
  if v.id is null or not public.user_in_org(v.organization_id) or not public.user_can_edit() then raise exception 'Vendor not found' using errcode = '23503'; end if;
  if nullif(p_ls_vendor_id, '') is not null and not exists (select 1 from public.ls_vendors where organization_id = v.organization_id and ls_vendor_id = p_ls_vendor_id) then
    raise exception 'That Lightspeed vendor is not on the list' using errcode = '23503';
  end if;
  update public.vendors set lightspeed_vendor_id = nullif(p_ls_vendor_id, ''),
         lightspeed_name = coalesce((select name from public.ls_vendors where organization_id = v.organization_id and ls_vendor_id = nullif(p_ls_vendor_id, '')), lightspeed_name),
         po_code = nullif(upper(regexp_replace(coalesce(p_po_code, ''), '[^A-Za-z0-9]', '', 'g')), '')
   where id = p_vendor;
end;
$$;
revoke execute on function public.vendor_set_ls(uuid, text, text) from public, anon;
grant execute on function public.vendor_set_ls(uuid, text, text) to authenticated, service_role;
