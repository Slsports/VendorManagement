-- 0053 — Review rules by Lightspeed category, subcategories too (Dana, Oct 8): "Jarrett does the orders for
-- Sunglasses, Knives, Hunting and Camping." The department rule becomes the category rule: its value is a
-- top-level category or a subcategory ("Camping", "Camping/Coolers"); a top level covers its subcategories;
-- the most specific rule wins. It matches the department or category a review names and the vendor's own
-- categories. Adding a rule proposes it, in the review queue, as "who orders from it" for the vendors in
-- that category nobody orders from yet.

-- "Camping" covers "CAMPING" and "Camping/Coolers"; "Camping/Coolers" covers only itself and below.
create or replace function public.category_covers(p_rule text, p_path text)
returns boolean language sql immutable as $$
  select nullif(trim(p_rule), '') is not null and nullif(trim(p_path), '') is not null
     and (upper(trim(p_path)) = upper(trim(p_rule)) or upper(trim(p_path)) like upper(trim(p_rule)) || '/%')
$$;

-- The categories a review is about: the department or category it names, and its vendors' categories.
create or replace function public.review_category_paths(p_vendor uuid, p_other uuid, p_details jsonb)
returns text[] language sql stable security definer set search_path = public as $$
  select array_remove(array[nullif(trim(p_details->>'department'), ''), nullif(trim(p_details->>'category'), '')], null)
      || coalesce((select array_agg(distinct c.name) from public.vendor_categories vc join public.categories c on c.id = vc.category_id
                    where vc.vendor_id in (p_vendor, p_other)), '{}')
$$;

create or replace function public.review_assignee_for(p_org uuid, p_kind text, p_entity_type text, p_entity_id uuid, p_details jsonb)
returns uuid
language plpgsql stable security definer
set search_path = public
as $$
declare
  v_vendor  uuid;
  v_other   uuid;
  v_dept    text;
  v_fishing boolean;
  v_owner   uuid;
  v_paths   text[];
  v_cat     uuid;
  r         record;
begin
  v_vendor := case when p_entity_type = 'vendor' then p_entity_id else nullif(p_details->>'vendor_id', '')::uuid end;
  v_other  := nullif(p_details->>'other_vendor_id', '')::uuid;
  v_dept   := upper(nullif(trim(coalesce(p_details->>'department', '')), ''));
  v_fishing := (v_dept = 'FISHING')
    or exists (select 1 from public.vendors v where v.id in (v_vendor, v_other) and v.is_fishing);
  select v.assigned_buyer_id into v_owner
    from public.vendors v join public.profiles p on p.id = v.assigned_buyer_id and p.is_active
   where v.id in (v_vendor, v_other) and v.organization_id = p_org
   order by (v.id = v_vendor) desc
   limit 1;
  -- The most specific category rule that covers any of the review's categories.
  v_paths := public.review_category_paths(v_vendor, v_other, p_details);
  select rr.assignee_id into v_cat
    from public.review_assignment_rules rr
   where rr.organization_id = p_org and rr.is_active and rr.match_kind = 'department'
     and exists (select 1 from unnest(v_paths) p where public.category_covers(rr.match_value, p))
   order by length(trim(rr.match_value)) desc, rr.priority, rr.created_at
   limit 1;
  for r in
    select * from public.review_assignment_rules
    where organization_id = p_org and is_active
    order by priority,
      case match_kind when 'vendor' then 0 when 'fishing' then 1 when 'department' then 2 when 'review_kind' then 3 else 4 end,
      created_at
  loop
    if r.match_kind = 'vendor' and r.vendor_id in (v_vendor, v_other) then return r.assignee_id; end if;
    if r.match_kind = 'fishing' and v_fishing then return r.assignee_id; end if;
    if r.match_kind = 'department' and v_cat is not null then return v_cat; end if;
    if r.match_kind = 'review_kind' and r.match_value = p_kind then return r.assignee_id; end if;
    if r.match_kind = 'fallback' then return coalesce(v_owner, r.assignee_id); end if;
  end loop;
  return v_owner;
end;
$$;

-- After a category rule is added: "who orders from it?" cards for its vendors nobody orders from yet.
create or replace function public.propose_category_assignments(p_rule uuid)
returns integer
language plpgsql security definer
set search_path = public
as $$
declare
  rr      public.review_assignment_rules%rowtype;
  v_name  text;
  v_admin uuid;
  n       integer;
begin
  if not public.is_admin() then raise exception 'Only admins set review rules' using errcode = '42501'; end if;
  select * into rr from public.review_assignment_rules where id = p_rule;
  if rr.id is null or not public.user_in_org(rr.organization_id) or rr.match_kind <> 'department' then raise exception 'Category rule not found' using errcode = '23503'; end if;
  select full_name into v_name from public.profiles where id = rr.assignee_id;
  select id into v_admin from public.profiles where organization_id = rr.organization_id and role = 'admin' and is_active order by created_at limit 1;
  insert into public.review_items (organization_id, kind, entity_type, entity_id, title, details, assigned_to, assigned_at)
  select v.organization_id, 'vendor_assignment', 'vendor', v.id,
         v.name || ': ' || rr.match_value || ' goes to ' || coalesce(v_name, 'someone'),
         jsonb_build_object('reason', 'In ' || rr.match_value || '; the category rule says ' || coalesce(v_name, 'someone') || ' orders it',
                            'proposed_assignee_id', rr.assignee_id, 'proposed_assignee_name', v_name),
         v_admin, now()
    from public.vendors v
   where v.organization_id = rr.organization_id and v.is_active and v.assigned_buyer_id is null
     and exists (select 1 from public.vendor_categories vc join public.categories c on c.id = vc.category_id
                  where vc.vendor_id = v.id and public.category_covers(rr.match_value, c.name)
                    -- a more specific rule ("Camping/Coolers") has that category, not this one
                    and not exists (select 1 from public.review_assignment_rules r2
                                     where r2.organization_id = rr.organization_id and r2.is_active and r2.match_kind = 'department' and r2.id <> rr.id
                                       and length(trim(r2.match_value)) > length(trim(rr.match_value)) and public.category_covers(r2.match_value, c.name)))
     and not exists (select 1 from public.review_items r where r.entity_type = 'vendor' and r.entity_id = v.id and r.kind = 'vendor_assignment' and r.status = 'pending');
  get diagnostics n = row_count;
  return n;
end;
$$;
revoke execute on function public.propose_category_assignments(uuid) from public, anon;
grant execute on function public.propose_category_assignments(uuid) to authenticated, service_role;
