-- 0043 — Conversations that went to Worldwide Warehouse only through the domain rule (newsletters, show
-- mail) start over: unfiled, then each email filed by what it says. The warehouse's own mail stays.
do $$
declare
  t record;
  e record;
begin
  for t in
    select th.id from public.email_threads th join public.vendors v on v.id = th.vendor_id and v.name = 'Worldwide Warehouse'
     where not exists (
       select 1 from public.emails x join public.vendor_emails ve on ve.vendor_id = v.id and lower(ve.email) = lower(x.from_email)
        where x.thread_id = th.id)
       and not exists (
       select 1 from public.emails x join public.vendor_emails ve on ve.vendor_id = v.id and lower(ve.email) = any (select lower(a) from unnest(x.to_emails || x.cc_emails) a)
        where x.thread_id = th.id)
  loop
    update public.email_threads set vendor_id = null where id = t.id;
    update public.emails set vendor_id = null, match_how = null where thread_id = t.id and coalesce(match_how, '') <> 'manual';
    for e in select id from public.emails where thread_id = t.id order by received_at loop
      perform public.mail_link_email(e.id);
    end loop;
    perform public.mail_refresh_thread(t.id, true);
  end loop;
end $$;
