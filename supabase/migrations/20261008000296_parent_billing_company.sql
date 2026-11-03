-- 0296 — One parent company billing several brands (Dana, Nov 3: JollyBuyer Inc is the parent and billing company for
--   Anngoti, Oeelinn and Pom Pom Tail; "we leave them separate … search in vms will bring up all 3"; "go on the JollyBuyer setup").
--   * vendors.parent_company: shown on the vendor and found by the top search.
--   * vendors.wwd_billing_names: the names WWD bills these brands under (all three: "JOLLY BUYER DBA POM POM TAIL",
--     "JOLLYBUYER INC"). A WWD invoice under one of them goes to the brand of the order it is tied to by our PO; with no
--     order, to the brand whose name is in WWD's name (Pom Pom Tail). Never to more than one.
--   * Pom Pom Tail added as a WWD vendor from the WWD portal record "Jollybuyer Inc" (#33950).
set local lock_timeout = '5s';

alter table public.vendors add column if not exists parent_company text;
alter table public.vendors add column if not exists wwd_billing_names text[] not null default '{}';
comment on column public.vendors.parent_company is 'The parent company that owns and bills this brand (JollyBuyer Inc for Anngoti, Oeelinn, Pom Pom Tail).';
comment on column public.vendors.wwd_billing_names is 'Names WWD bills this brand under that it shares with sister brands; the invoice''s PO decides the brand.';

create or replace function public.wwd_billing_names_link(p_org uuid) returns integer
language plpgsql security definer set search_path = public as $$
declare
  i   record;
  v   uuid;
  n   integer := 0;
begin
  for i in
    select w.id, w.order_id, w.wwd_vendor_name from public.wwd_invoices w
     where w.organization_id = p_org and w.vendor_id is null and w.carrier_id is null and w.wwd_vendor_name is not null
       and exists (select 1 from public.vendors x where x.organization_id = p_org and x.merged_into_id is null
                     and upper(trim(w.wwd_vendor_name)) = any (select upper(trim(b)) from unnest(x.wwd_billing_names) b))
  loop
    v := null;
    -- the order it is tied to (our PO), when that order's vendor is billed under this name
    select o.vendor_id into v from public.orders o join public.vendors x on x.id = o.vendor_id
     where o.id = i.order_id and upper(trim(i.wwd_vendor_name)) = any (select upper(trim(b)) from unnest(x.wwd_billing_names) b);
    -- else the one brand whose own name is in WWD's name ("Jolly Buyer DBA Pom Pom Tail")
    if v is null then
      select (array_agg(x.id))[1] into v from public.vendors x
       where x.organization_id = p_org and x.merged_into_id is null
         and upper(trim(i.wwd_vendor_name)) = any (select upper(trim(b)) from unnest(x.wwd_billing_names) b)
         and position(public.payee_key(x.name) in public.payee_key(i.wwd_vendor_name)) > 0
      having count(*) = 1;
    end if;
    if v is not null then
      update public.wwd_invoices set vendor_id = v, vendor_set_by = 'auto', updated_at = now() where id = i.id;
      n := n + 1;
    end if;
  end loop;
  if n > 0 then perform public.wwd_relink(p_org); end if;
  return n;
end;
$$;
revoke execute on function public.wwd_billing_names_link(uuid) from public, anon, authenticated;
grant execute on function public.wwd_billing_names_link(uuid) to service_role;

-- the weekly upload's follow-up runs it too (0295's wwd_upload_done, unchanged otherwise)
create or replace function public.wwd_upload_done_billing() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform public.wwd_billing_names_link(new.organization_id);
  return null;
end;
$$;
revoke execute on function public.wwd_upload_done_billing() from public, anon, authenticated;
drop trigger if exists wwd_uploads_billing_names on public.wwd_uploads;
create trigger wwd_uploads_billing_names after insert on public.wwd_uploads for each row execute function public.wwd_upload_done_billing();

-- Dana's JollyBuyer setup (hosted data; skipped where the records are not there, e.g. the test database)
do $$
declare
  v_org  uuid := '00000000-0000-0000-0000-000000000001';
  p      public.wwd_portal_vendors%rowtype;
  v_pom  uuid;
  names  text[] := array['JOLLY BUYER DBA POM POM TAIL', 'JOLLYBUYER INC'];
begin
  select * into p from public.wwd_portal_vendors where organization_id = v_org and number = '33950' and vendor_id is null;
  if p.id is not null then
    -- as promote_line_to_vendor does (that one needs a signed-in editor): the vendor, its WWD route, the line points at it
    insert into public.vendors (organization_id, name, phone, notes)
    values (v_org, 'POM POM TAIL', p.data->'address'->>'phone', 'WWD vendor #33950 "Jollybuyer Inc". Parent and billing company: JollyBuyer Inc (also bills Anngoti and Oeelinn). Added Nov 3, 2026 (Dana).')
    returning id into v_pom;
    insert into public.vendor_billing_routes (vendor_id, route, is_default) values (v_pom, 'worldwide', true);
    if p.line_id is not null then update public.vendor_directory set matched_vendor_id = v_pom where id = p.line_id and matched_vendor_id is null; end if;
    update public.wwd_portal_vendors set vendor_id = v_pom where id = p.id;
    perform public.wwd_portal_apply(p.id);
  end if;
  update public.vendors set parent_company = 'JollyBuyer Inc', wwd_billing_names = names
   where organization_id = v_org and merged_into_id is null and upper(name) in ('ANNGOTI', 'OEELINN', 'POM POM TAIL');
  if exists (select 1 from public.organizations where id = v_org) then
    perform public.wwd_billing_names_link(v_org);
  end if;
end $$;
