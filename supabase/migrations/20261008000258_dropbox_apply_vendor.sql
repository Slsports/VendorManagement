-- 0258 — Dropbox: picking a vendor for one "vendor not found" file can file every other file read as the same name
-- under that vendor, and remembers the name as the vendor's alias so later reads match on their own (Dana, Oct 27).

set local lock_timeout = '5s';

-- The other files on the list read as the same printed name (for the "Apply to the other N files" question).
create or replace function public.dropbox_same_vendor_count(p_file uuid) returns integer
language sql stable security definer set search_path = public as $$
  select count(*)::int from public.dropbox_files o, public.dropbox_files f
   where f.id = p_file and public.is_admin() and public.user_in_org(f.organization_id)
     and o.organization_id = f.organization_id and o.id <> f.id and o.status in ('leftover', 'proposed') and o.decided_by is null
     and o.target in ('vendor', 'line') and f.vendor_said is not null and lower(trim(o.vendor_said)) = lower(trim(f.vendor_said))
$$;
revoke execute on function public.dropbox_same_vendor_count(uuid) from public, anon;
grant execute on function public.dropbox_same_vendor_count(uuid) to authenticated;

-- Approve this file under the vendor (its folder as picked), the others read as the same name under the vendor too
-- (each keeps its own folder), and the printed name becomes the vendor's alias. Returns how many files were approved.
create or replace function public.dropbox_apply_vendor(p_file uuid, p_vendor uuid, p_kind text, p_apply_same boolean default false)
returns integer language plpgsql security definer set search_path = public as $$
declare f public.dropbox_files%rowtype; v_n integer := 1; v_said text; v_aliases text[];
begin
  select * into f from public.dropbox_files where id = p_file;
  if f.id is null or not public.is_admin() or not public.user_in_org(f.organization_id) then raise exception 'Only the admin approves Dropbox filing'; end if;
  if not exists (select 1 from public.vendors v where v.id = p_vendor and v.organization_id = f.organization_id) then raise exception 'Vendor not found'; end if;
  update public.dropbox_files set status = 'approved', target = 'vendor', vendor_id = p_vendor, line_id = null, rep_group_id = null, kind = p_kind,
         decided_by = auth.uid(), decided_at = now(), updated_at = now()
   where id = p_file;
  v_said := nullif(trim(f.vendor_said), '');
  if p_apply_same and v_said is not null then
    update public.dropbox_files o set status = 'approved', target = 'vendor', vendor_id = p_vendor, line_id = null, rep_group_id = null,
           kind = coalesce(o.kind, p_kind), decided_by = auth.uid(), decided_at = now(), updated_at = now(),
           note = left('Filed under the vendor Dana picked for "' || v_said || '". ' || coalesce(o.note, ''), 400)
     where o.organization_id = f.organization_id and o.id <> f.id and o.status in ('leftover', 'proposed') and o.decided_by is null
       and o.target in ('vendor', 'line') and lower(trim(o.vendor_said)) = lower(v_said);
    get diagnostics v_n = row_count;
    v_n := v_n + 1;
    -- the printed name becomes the vendor's alias, once, unless it already is the vendor's name or an alias
    select coalesce(aliases, '{}') into v_aliases from public.vendors where id = p_vendor;
    if not exists (select 1 from public.vendors v where v.id = p_vendor and (lower(v.name) = lower(v_said) or lower(v_said) = any (select lower(a) from unnest(coalesce(v.aliases, '{}')) a))) then
      update public.vendors set aliases = array_append(v_aliases, v_said) where id = p_vendor;
    end if;
  end if;
  return v_n;
end $$;
revoke execute on function public.dropbox_apply_vendor(uuid, uuid, text, boolean) from public, anon;
grant execute on function public.dropbox_apply_vendor(uuid, uuid, text, boolean) to authenticated;
