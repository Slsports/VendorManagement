-- 0157 — Item Notes from Lightspeed (Dana, Oct 18: "Item Notes should show in VMS"). ls-sync copies each item's Note
-- (note text; public = prints on the customer's receipt, private = internal). The reports read the note for the
-- do-not-reorder story: * discontinued, ** DNR, "REPLACED WITH <Vendor ID>", "OUT OF STOCK AT VENDOR … BACK …".
alter table public.ls_items add column if not exists note text not null default '';
alter table public.ls_items add column if not exists note_public boolean not null default false;
comment on column public.ls_items.note is 'The item''s Note in Lightspeed (ItemNote.note).';
comment on column public.ls_items.note_public is 'Lightspeed ItemNote.isPublic: true prints on the customer''s receipt, false is internal.';

-- ls_report_rows now returns the note too (the return type changes, so the function is replaced).
drop function if exists public.ls_report_rows(uuid, date, date, text[], text[], text[]);
create or replace function public.ls_report_rows(
  p_org uuid, p_from date, p_to date, p_shops text[], p_vendor_ids text[] default null, p_category_prefixes text[] default null)
returns table (
  item_id text, system_sku text, upc text, vendor_item_id text, custom_sku text, manufacturer_sku text, description text,
  default_cost numeric, category_path text, default_vendor_id text, vendor_name text, archived boolean, item_type text,
  qoh jsonb, sold jsonb, sold_total numeric, last_sold date, note text, note_public boolean)
language plpgsql stable security definer set search_path = public as $$
begin
  if auth.uid() is not null and not public.user_in_org(p_org) then raise exception 'Not your organization' using errcode = '42501'; end if;
  return query
  with items as (
    select i.* from public.ls_items i
     where i.organization_id = p_org
       and (p_vendor_ids is null or i.default_vendor_id = any (p_vendor_ids))
       and (p_category_prefixes is null or exists (select 1 from unnest(p_category_prefixes) c where i.category_path = c or i.category_path like c || '/%'))
  ),
  good as (
    select l.item_id, l.shop_id, l.qty, l.sold_at
      from public.ls_sale_lines l
      join items i on i.item_id = l.item_id
      left join public.ls_sales s on s.organization_id = l.organization_id and s.sale_id = l.sale_id
     where l.organization_id = p_org and l.shop_id = any (p_shops)
       and (s.sale_id is null or (s.completed and not s.voided))
  ),
  sales as (
    select g.item_id, g.shop_id, sum(g.qty) as qty from good g
     where g.sold_at >= p_from::timestamptz and g.sold_at < (p_to + 1)::timestamptz
     group by g.item_id, g.shop_id
  ),
  per_item as (
    select sa.item_id, jsonb_object_agg(sa.shop_id, sa.qty) as sold, sum(sa.qty) as total from sales sa group by sa.item_id
  ),
  last as (
    select g.item_id, max(g.sold_at)::date as last_sold from good g where g.qty > 0 group by g.item_id
  )
  select i.item_id, i.system_sku, i.upc, i.vendor_item_id, i.custom_sku, i.manufacturer_sku, i.description, i.default_cost,
         i.category_path, i.default_vendor_id, coalesce(v.name, ''), i.archived, i.item_type,
         i.qoh, coalesce(p.sold, '{}'::jsonb), coalesce(p.total, 0), la.last_sold, i.note, i.note_public
    from items i
    left join public.ls_vendors v on v.organization_id = i.organization_id and v.ls_vendor_id = i.default_vendor_id
    left join per_item p on p.item_id = i.item_id
    left join last la on la.item_id = i.item_id;
end;
$$;
revoke execute on function public.ls_report_rows(uuid, date, date, text[], text[], text[]) from public, anon;
grant execute on function public.ls_report_rows(uuid, date, date, text[], text[], text[]) to authenticated, service_role;
