-- 0050 — "Harbor Freight is not a vendor, it's a shipping carrier" (Dana, Oct 8). The Lightspeed name
-- HARBOR FREIGHT came in as a vendor (no orders); Priority One's tracking updates name the carrier
-- "Oak Harbor Freight (OAKH)", so those emails were filed to it. Remove it the way "Delete" in the review
-- queue does (imports skip the name), add Oak Harbor Freight as an LTL carrier, and file its mail again.
do $$
declare
  v       record;
  n       text;
  r       record;
begin
  for v in select * from public.vendors where name = 'HARBOR FREIGHT' and not exists (select 1 from public.orders o where o.vendor_id = vendors.id) loop
    for n in select distinct x from unnest(array[v.name, v.lightspeed_name] || v.aliases) as x where nullif(trim(x), '') is not null loop
      insert into public.vendor_exclusions (organization_id, name, note)
      values (v.organization_id, n, 'Not a vendor: Oak Harbor Freight is a shipping carrier (Dana, Oct 8)')
      on conflict (organization_id, name_key) do nothing;
    end loop;
    update public.review_items set status = 'rejected', resolved_at = now(), resolution_note = 'Vendor deleted: a shipping carrier'
     where status = 'pending' and organization_id = v.organization_id
       and ((entity_type = 'vendor' and entity_id = v.id) or details->>'other_vendor_id' = v.id::text or details->>'vendor_id' = v.id::text);
    update public.email_senders set kind = 'unknown', vendor_id = null, decided_at = null, decided_by = null where vendor_id = v.id and kind = 'vendor';
    insert into public.activity_log (organization_id, entity_type, entity_id, action, details)
    values (v.organization_id, 'vendor', v.id, 'vendor_deleted', jsonb_build_object('name', v.name, 'note', 'A shipping carrier, not a vendor (Dana, Oct 8)'));

    -- Its threads lose the vendor; each email is filed again by the usual rules (now without it).
    create temp table if not exists hf_threads (id uuid) on commit drop;
    insert into hf_threads select id from public.email_threads where vendor_id = v.id;
    update public.emails set vendor_id = null, match_how = null where vendor_id = v.id;
    update public.email_threads set vendor_id = null where vendor_id = v.id;
    delete from public.vendors where id = v.id;
    update public.emails set mentioned_vendor_ids = array_remove(mentioned_vendor_ids, v.id) where v.id = any (mentioned_vendor_ids);
    for r in select e.id, e.thread_id from public.emails e join hf_threads h on h.id = e.thread_id order by e.received_at loop
      perform public.mail_link_email(r.id);
    end loop;
    for r in select id from hf_threads loop
      perform public.mail_refresh_thread(r.id, false);
    end loop;
  end loop;
end $$;

insert into public.carriers (organization_id, name, mode, email_domains, website, owner_id, notes)
select o.id, 'Oak Harbor Freight', 'ltl', array['oakh.com'], 'https://www.oakh.com',
       (select owner_id from public.carriers c where c.organization_id = o.id and c.name = 'Priority One'),
       'LTL carrier (OAKH). Priority One books it; its tracking updates come from Priority One.'
  from public.organizations o
 where exists (select 1 from public.mail_accounts m where m.organization_id = o.id)
on conflict (organization_id, name) do nothing;
