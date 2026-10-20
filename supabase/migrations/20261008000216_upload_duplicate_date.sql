-- 0216 — "Already in VMS from their email" names the day the email came, not the day VMS filed it (mail loaded back
-- to 12 months all shows the load day).
create or replace function public.invoice_doc_duplicate(p_vendor uuid, p_kind text, p_number text, p_except uuid default null) returns text
language sql stable security definer set search_path = public as $$
  select case
           when u.id is not null then 'Already submitted by ' || coalesce(nullif(split_part(p.full_name, ' ', 1), ''), 'someone') || ' on ' || to_char(u.uploaded_on, 'Mon FMDD, YYYY')
           when l.source = 'email' then 'Already in VMS from their email' || coalesce(', ' || to_char(coalesce(e.received_at, l.created_at) at time zone 'America/Los_Angeles', 'Mon FMDD, YYYY'), '')
           else 'Already in VMS' || coalesce(', filed ' || to_char(l.created_at at time zone 'America/Los_Angeles', 'Mon FMDD, YYYY'), '') || coalesce(' by ' || nullif(split_part(c.full_name, ' ', 1), ''), '')
         end
    from public.vendor_links l
    left join public.invoice_uploads u on u.id = l.upload_id
    left join public.profiles p on p.id = u.uploaded_by
    left join public.profiles c on c.id = l.created_by
    left join public.emails e on e.id = l.email_id
   where l.vendor_id = p_vendor and l.kind = p_kind and (p_except is null or l.id <> p_except)
     and nullif(regexp_replace(public.po_norm(p_number), '^0+', ''), '') is not null
     and regexp_replace(public.po_norm(l.doc_number), '^0+', '') = regexp_replace(public.po_norm(p_number), '^0+', '')
   order by l.created_at limit 1
$$;
