-- 0107 — Show lists matched to vendors again (Dana, Oct 12: "Why does it say that Royal Deluxe is not on any show lists?").
-- Only about one in five show lines was tied to a vendor: "Royal Deluxe" on the list never found ROYAL DELUXE ACCESSORIES.
-- Now a line also matches a vendor's other names (aliases), or the one vendor whose name starts with it; Claude compares
-- the rest with the vendor list: sure matches are tied, maybes become "Show line" cards. Booth holders stay as listed
-- (Manufacturers Exchange is Sunny Lakhani's booth, not Royal Deluxe).

alter table public.vendor_directory add column if not exists show_match_read_at timestamptz;

create or replace function public.name_norm(p text)
returns text language sql immutable as $$
  select regexp_replace(trim(regexp_replace(regexp_replace(lower(regexp_replace(coalesce(p, ''), '\s+-\s+.*$', '')), '[^a-z0-9 ]', ' ', 'g'),
         '\m(inc|llc|co|corp|company|ltd|the)\M', '', 'g')), '\s+', ' ', 'g')
$$;

-- Tie a show line to a vendor, and its show appearances with it. No permission check: callers check.
create or replace function public.show_line_link(p_line uuid, p_vendor uuid)
returns void language sql security definer set search_path = public as $$
  update public.vendor_directory set matched_vendor_id = p_vendor where id = p_line;
  update public.show_appearances set vendor_id = p_vendor where line_id = p_line;
$$;

-- Lines on a show list with no vendor yet, for Claude (service role).
create or replace function public.show_line_queue(p_org uuid, p_limit integer default 100)
returns table (line_id uuid, name text, exhibitors text, shows text)
language sql stable security definer set search_path = public as $$
  select d.id, d.name, string_agg(distinct a.exhibitor, '; '), string_agg(distinct a.show_label, '; ')
    from public.vendor_directory d join public.show_appearances a on a.line_id = d.id
   where d.organization_id = p_org and d.matched_vendor_id is null and d.show_match_read_at is null
   group by d.id, d.name
   order by d.name
   limit p_limit
$$;

-- Claude's answer for one line: sure → tied; maybe → a card for a person.
create or replace function public.show_line_apply(p_line uuid, p_vendor uuid, p_sure boolean)
returns text language plpgsql security definer set search_path = public as $$
declare
  d  public.vendor_directory%rowtype;
  v  public.vendors%rowtype;
begin
  select * into d from public.vendor_directory where id = p_line;
  if not found then return 'gone'; end if;
  update public.vendor_directory set show_match_read_at = now() where id = p_line;
  if p_vendor is null or d.matched_vendor_id is not null then return 'none'; end if;
  select * into v from public.vendors where id = p_vendor and organization_id = d.organization_id and merged_into_id is null;
  if not found then return 'none'; end if;
  if p_sure then
    perform public.show_line_link(p_line, p_vendor);
    return 'linked';
  end if;
  if not exists (select 1 from public.review_items r where r.kind = 'show_line' and r.details->>'line_id' = p_line::text) then
    insert into public.review_items (organization_id, kind, entity_type, entity_id, title, details)
    values (d.organization_id, 'show_line', 'vendor', v.id, format('Is "%s" on the show list our vendor %s?', d.name, v.name),
            jsonb_build_object('line_id', d.id, 'line_name', d.name, 'vendor_id', v.id, 'vendor_name', v.name, 'vendor_id_for_rules', v.id,
                               'shows', (select string_agg(distinct a.show_label || coalesce(' · booth ' || a.booth, ''), '; ') from public.show_appearances a where a.line_id = d.id)));
  end if;
  return 'asked';
end;
$$;

-- A person answers a Show line card.
create or replace function public.resolve_show_line(p_item uuid, p_yes boolean)
returns void language plpgsql security definer set search_path = public as $$
declare r public.review_items%rowtype;
begin
  if not public.user_can_edit() then raise exception 'Only admins, managers and buyers decide show lines'; end if;
  select * into r from public.review_items where id = p_item for update;
  if not found or not public.user_in_org(r.organization_id) or r.kind <> 'show_line' then raise exception 'Card not found'; end if;
  if r.status <> 'pending' then return; end if;
  if p_yes then perform public.show_line_link((r.details->>'line_id')::uuid, (r.details->>'vendor_id')::uuid); end if;
  update public.review_items set status = case when p_yes then 'accepted'::public.review_status else 'rejected'::public.review_status end,
         resolved_by = auth.uid(), resolved_at = now(), resolution_note = case when p_yes then 'Same vendor' else 'Not the same' end
   where id = p_item;
end;
$$;

revoke execute on function public.show_line_link(uuid, uuid), public.show_line_queue(uuid, integer), public.show_line_apply(uuid, uuid, boolean) from public, anon, authenticated;
grant execute on function public.show_line_link(uuid, uuid), public.show_line_queue(uuid, integer), public.show_line_apply(uuid, uuid, boolean) to service_role;
revoke execute on function public.resolve_show_line(uuid, boolean) from public, anon;
grant execute on function public.resolve_show_line(uuid, boolean) to authenticated, service_role;
grant execute on function public.name_norm(text) to authenticated, service_role;

-- Now: lines whose name is a vendor's name or other name, or the start of exactly one vendor's name.
do $$
declare r record;
begin
  for r in
    with names as (
      select v.id, v.organization_id, public.name_norm(x) as n from public.vendors v cross join lateral unnest(array[v.name] || v.aliases) x
       where v.is_active and v.merged_into_id is null
    ), lines as (
      select d.id, d.organization_id, public.name_norm(d.name) as n from public.vendor_directory d
       where d.matched_vendor_id is null and exists (select 1 from public.show_appearances a where a.line_id = d.id)
    ), hits as (
      select l.id as line_id, array_agg(distinct nm.id) as ids from lines l join names nm on nm.organization_id = l.organization_id and length(nm.n) >= 3
        and (nm.n = l.n or (l.n ~ ' ' and nm.n like l.n || ' %'))
       group by l.id
    )
    select line_id, ids[1] as vendor_id from hits where cardinality(ids) = 1
  loop
    perform public.show_line_link(r.line_id, r.vendor_id);
  end loop;
end $$;
