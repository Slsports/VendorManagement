-- 0211 — "Who is this?": pick everything that applies, then Save (Dana, Oct 20: "If it's from a rep in a rep group, but
-- it's about a vendor do I pick the vendor name or tag it to the rep group? … I should be able to select all options that
-- apply without the card disappearing as soon as I pick a vendor").
--   rep group (+ vendors)  the sender is that rep group; each email files to the vendor it names; the vendors picked
--                          become the group's lines (a vendor already with another rep group is left as it is)
--   one vendor             the company's own staff: all their mail files to that vendor (as before)
--   several vendors        sends for several vendors: each email files to the vendor it names
create or replace function public.resolve_email_sender_many(p_sender uuid, p_rep_group uuid, p_vendors uuid[])
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  s        public.email_senders%rowtype;
  v_ids    uuid[] := coalesce((select array_agg(distinct x) from unnest(p_vendors) x where x is not null), '{}');
  v_linked integer;
  v_added  text[] := '{}';
  v_kept   text[] := '{}';
  v        record;
begin
  if not public.user_can_edit() then raise exception 'Only admins, managers and buyers decide senders' using errcode = '42501'; end if;
  select * into s from public.email_senders where id = p_sender;
  if not found or not public.user_in_org(s.organization_id) then raise exception 'Sender not found' using errcode = '23503'; end if;
  if exists (select 1 from unnest(v_ids) x where not exists (select 1 from public.vendors where id = x and organization_id = s.organization_id)) then
    raise exception 'Vendor not found' using errcode = '23503';
  end if;
  if p_rep_group is not null then
    -- the lines first, so the mail can file by them
    for v in select id, name, rep_group_id from public.vendors where id = any (v_ids) loop
      if v.rep_group_id is null then
        update public.vendors set rep_group_id = p_rep_group where id = v.id;
        insert into public.activity_log (organization_id, entity_type, entity_id, action, details, actor_id)
        values (s.organization_id, 'vendor', v.id, 'rep_group_set', jsonb_build_object('rep_group_id', p_rep_group, 'from', 'who_is_this'), auth.uid());
        v_added := v_added || v.name;
      elsif v.rep_group_id <> p_rep_group then
        v_kept := v_kept || v.name;
      end if;
    end loop;
    v_linked := public.resolve_email_sender(p_sender, 'rep_group', null, p_rep_group);
  elsif cardinality(v_ids) = 1 then
    v_linked := public.resolve_email_sender(p_sender, 'vendor', v_ids[1], null);
  elsif cardinality(v_ids) > 1 then
    v_linked := public.resolve_email_sender(p_sender, 'platform', null, null);
  else
    raise exception 'Pick a rep group or a vendor' using errcode = '22023';
  end if;
  return jsonb_build_object('linked', v_linked, 'lines_added', to_jsonb(v_added), 'kept_with_other_group', to_jsonb(v_kept));
end;
$$;
revoke execute on function public.resolve_email_sender_many(uuid, uuid, uuid[]) from public, anon;
grant execute on function public.resolve_email_sender_many(uuid, uuid, uuid[]) to authenticated;
