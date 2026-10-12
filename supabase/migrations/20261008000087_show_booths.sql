-- 0108 — Booths (Dana, Oct 12): "Always double check the booth number. If they are in the same booth, it is generally the same
-- rep group." Claude sees each show line's booth and booth-mates when matching; and a vendor with no rep group that shared a
-- booth with another rep group's lines gets a "Booth-mates" card (add it to that rep group?). Zero upcharge from the show
-- lists is carried to every vendor its lines are now tied to.

-- Show lines for Claude, with their booths and the vendors they shared them with.
drop function if exists public.show_line_queue(uuid, integer);
create or replace function public.show_line_queue(p_org uuid, p_limit integer default 100)
returns table (line_id uuid, name text, exhibitors text, shows text, booth_mates text)
language sql stable security definer set search_path = public as $$
  select d.id, d.name, string_agg(distinct a.exhibitor, '; '), string_agg(distinct a.show_label || coalesce(' booth ' || a.booth, ''), '; '),
         (select string_agg(distinct v.name, '; ') from public.show_appearances a2 join public.show_appearances m on m.show_code = a2.show_code and m.booth = a2.booth and m.line_id <> a2.line_id
            join public.vendors v on v.id = m.vendor_id where a2.line_id = d.id)
    from public.vendor_directory d join public.show_appearances a on a.line_id = d.id
   where d.organization_id = p_org and d.matched_vendor_id is null and d.show_match_read_at is null
   group by d.id, d.name
   order by d.name
   limit p_limit
$$;
revoke execute on function public.show_line_queue(uuid, integer) from public, anon, authenticated;
grant execute on function public.show_line_queue(uuid, integer) to service_role;

-- Booth-mate cards: a vendor with no rep group shared a booth (at a show, at most 15 lines in it) with two or more lines of one
-- rep group. Returns how many cards were added.
create or replace function public.show_booth_rep_cards(p_org uuid)
returns integer language plpgsql security definer set search_path = public as $$
declare
  r  record;
  n  integer := 0;
begin
  for r in
    with booths as (
      select a.show_code, a.show_label, a.booth from public.show_appearances a
       where a.organization_id = p_org and a.booth is not null
       group by 1, 2, 3 having count(*) between 2 and 15
    ), members as (
      select b.show_code, b.show_label, b.booth, v.id as vendor_id, v.name, v.rep_group_id
        from booths b join public.show_appearances a on a.show_code = b.show_code and a.booth = b.booth
        join public.vendors v on v.id = a.vendor_id and v.is_active and v.merged_into_id is null
    ), groups as (
      select show_code, show_label, booth, rep_group_id, array_agg(distinct name) as names from members where rep_group_id is not null
       group by 1, 2, 3, 4 having count(distinct vendor_id) >= 2
    )
    select distinct on (m.vendor_id, g.rep_group_id) m.vendor_id, m.name, g.rep_group_id, rg.name as group_name, g.show_label, g.booth, g.names
      from members m join groups g on g.show_code = m.show_code and g.booth = m.booth
      join public.rep_groups rg on rg.id = g.rep_group_id and rg.is_active
     where m.rep_group_id is null
       and not exists (select 1 from public.review_items x where x.kind = 'booth_rep' and x.entity_id = m.vendor_id and x.details->>'rep_group_id' = g.rep_group_id::text)
     order by m.vendor_id, g.rep_group_id, g.show_code desc
  loop
    insert into public.review_items (organization_id, kind, entity_type, entity_id, title, details)
    values (p_org, 'booth_rep', 'vendor', r.vendor_id,
            format('%s was in booth %s at %s with %s''s lines. Add it to %s?', r.name, r.booth, r.show_label, r.group_name, r.group_name),
            jsonb_build_object('vendor_id', r.vendor_id, 'vendor_name', r.name, 'rep_group_id', r.rep_group_id, 'rep_group_name', r.group_name,
                               'show', r.show_label, 'booth', r.booth, 'booth_mates', to_jsonb(r.names)));
    n := n + 1;
  end loop;
  return n;
end;
$$;

create or replace function public.resolve_booth_rep(p_item uuid, p_yes boolean)
returns void language plpgsql security definer set search_path = public as $$
declare r public.review_items%rowtype;
begin
  if not public.user_can_edit() then raise exception 'Only admins, managers and buyers decide rep groups'; end if;
  select * into r from public.review_items where id = p_item for update;
  if not found or not public.user_in_org(r.organization_id) or r.kind <> 'booth_rep' then raise exception 'Card not found'; end if;
  if r.status <> 'pending' then return; end if;
  if p_yes then
    update public.vendors set rep_group_id = (r.details->>'rep_group_id')::uuid where id = r.entity_id and rep_group_id is null;
  end if;
  update public.review_items set status = case when p_yes then 'accepted'::public.review_status else 'rejected'::public.review_status end,
         resolved_by = auth.uid(), resolved_at = now(), resolution_note = case when p_yes then 'Added to ' || (r.details->>'rep_group_name') else 'Not with them' end
   where id = p_item;
end;
$$;
revoke execute on function public.show_booth_rep_cards(uuid) from public, anon, authenticated;
grant execute on function public.show_booth_rep_cards(uuid) to service_role;
revoke execute on function public.resolve_booth_rep(uuid, boolean) from public, anon;
grant execute on function public.resolve_booth_rep(uuid, boolean) to authenticated, service_role;

-- Zero upcharge: a vendor whose show line was on Worldwide's zero-upcharge list (now that more lines are tied).
with z as (
  update public.vendors v set wwd_zero_upcharge = true
   where not v.wwd_zero_upcharge and exists (select 1 from public.vendor_directory d where d.matched_vendor_id = v.id and d.zero_upcharge)
  returning v.id, v.organization_id
)
insert into public.activity_log (organization_id, entity_type, entity_id, action, details)
select organization_id, 'vendor', id, 'zero_upcharge_from_show_list', '{"show": "rematch Oct 12"}'::jsonb from z;
