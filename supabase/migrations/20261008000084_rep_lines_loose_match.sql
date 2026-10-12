-- 0105 — A rep's line that is already a vendor under a longer name ("Rapala" is RAPALA - NORMARK) is not asked about as a
-- new vendor. A name that one vendor's name or alias contains counts as that vendor; one several vendors contain is skipped.
create or replace function public.rep_group_apply_lines(p_sender uuid, p_vendor_ids uuid[], p_unknown text[])
returns jsonb
language plpgsql security definer
set search_path = public
as $$
declare
  s        public.email_senders%rowtype;
  g        public.rep_groups%rowtype;
  v        record;
  n        text;
  v_ids    uuid[] := coalesce(p_vendor_ids, '{}');
  v_hits   uuid[];
  v_added  text[] := '{}';
  v_asked  integer := 0;
begin
  select * into s from public.email_senders where id = p_sender;
  if not found or s.kind <> 'rep_group' or s.rep_group_id is null then return null; end if;
  select * into g from public.rep_groups where id = s.rep_group_id;
  update public.email_senders set rep_lines_read_at = now(), rep_lines_read_count = message_count where id = p_sender;

  -- names Claude read that are inside a vendor's name or alias
  foreach n in array coalesce(p_unknown, '{}') loop
    n := trim(n);
    continue when length(n) < 3;
    select array_agg(x.id) into v_hits from public.vendors x
     where x.organization_id = s.organization_id and x.is_active and x.merged_into_id is null
       and (x.name ilike '%' || n || '%' or exists (select 1 from unnest(x.aliases) a where a ilike '%' || n || '%'));
    if cardinality(v_hits) = 1 then
      v_ids := v_ids || v_hits[1];
    elsif coalesce(cardinality(v_hits), 0) = 0 and not exists (
        select 1 from public.review_items r where r.kind = 'rep_line' and r.organization_id = s.organization_id and lower(r.details->>'line_name') = lower(left(n, 120))) then
      insert into public.review_items (organization_id, kind, entity_type, entity_id, title, details)
      values (s.organization_id, 'rep_line', 'rep_group', g.id,
              format('%s reps %s, which is not one of our vendors. Add it?', g.name, left(n, 120)),
              jsonb_build_object('rep_group_id', g.id, 'rep_group_name', g.name, 'line_name', left(n, 120), 'sender_id', s.id));
      v_asked := v_asked + 1;
    end if;
  end loop;

  for v in select x.id, x.name, x.rep_group_id, og.name as other_name from public.vendors x left join public.rep_groups og on og.id = x.rep_group_id
            where x.id = any (v_ids) and x.organization_id = s.organization_id and x.merged_into_id is null loop
    if v.rep_group_id is null then
      update public.vendors set rep_group_id = g.id where id = v.id;
      v_added := v_added || v.name;
    elsif v.rep_group_id <> g.id and not exists (
        select 1 from public.review_items r where r.kind = 'rep_line' and r.entity_id = v.id and r.details->>'rep_group_id' = g.id::text) then
      insert into public.review_items (organization_id, kind, entity_type, entity_id, title, details)
      values (s.organization_id, 'rep_line', 'vendor', v.id,
              format('%s writes about %s, which is with %s. Move it to %s?', g.name, v.name, v.other_name, g.name),
              jsonb_build_object('rep_group_id', g.id, 'rep_group_name', g.name, 'vendor_id', v.id, 'vendor_name', v.name,
                                 'current_rep_group_id', v.rep_group_id, 'current_rep_group_name', v.other_name, 'sender_id', s.id));
      v_asked := v_asked + 1;
    end if;
  end loop;

  perform public.rep_group_tag_mail(p_sender);
  return jsonb_build_object('added', to_jsonb(v_added), 'asked', v_asked);
end;
$$;

-- The "Rapala" card asked today: Rapala is already a vendor (and with Premier Sales Solutions).
update public.review_items r set status = 'rejected', resolved_at = now(), resolution_note = 'Already a vendor'
 where r.kind = 'rep_line' and r.status = 'pending' and r.details->>'vendor_id' is null
   and exists (select 1 from public.vendors x where x.organization_id = r.organization_id and x.is_active and x.merged_into_id is null
                and (x.name ilike '%' || (r.details->>'line_name') || '%' or exists (select 1 from unnest(x.aliases) a where a ilike '%' || (r.details->>'line_name') || '%')));
