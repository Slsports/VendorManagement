-- 0307 — A rep sent the price list we asked for (Dana, Nov 3-4: "When a rep replies to an email where we have requested a price
--   list or catalog I want a text to go to me telling me we received it so I can go finish making my order. Or a notification
--   to whichever ee sent the email requesting pricelist/orderwriter and catalog" — "only if i made the request, I don't want
--   theirs" — "go").
--   When VMS files a price list, catalog or order form from a vendor's email (vendor_links, as the mail sync already does), and
--   our own earlier email in that conversation (or to that address in the 45 days before) asked for one, the person who asked
--   gets a task "<Vendor> sent the price list you asked for" that opens the reply, reminded right away. Who asked: the person
--   who sent it from VMS, else the store person who signed it (Dana, Trevor, Jarrett), else the admin. It is in the
--   "Price lists and catalogs" text category (0306), so it comes by text to whoever ticks that. One task per reply.
--   Back-check: replies of the last 30 days, as tasks without a reminder (no texts for old ones).
set local lock_timeout = '5s';

create or replace function public.price_list_reply_task(p_email uuid, p_remind boolean default true) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  e      public.emails%rowtype;
  ask    public.emails%rowtype;
  own    text;
  who    uuid;
  kinds  text;
  vname  text;
  v_task uuid;
  pat    constant text := '(price ?lists?|pricing|catalog|catalogue|order ?(writer|form|sheet)s?|line ?sheet|show specials|wholesale prices)';
begin
  select * into e from public.emails where id = p_email;
  if e.id is null or e.direction <> 'in' or e.vendor_id is null then return null; end if;
  -- our request: in this conversation, else to this address, before the reply
  select * into ask from public.emails x
   where x.thread_id = e.thread_id and x.direction = 'out' and x.received_at < e.received_at
     and (coalesce(x.subject, '') || ' ' || coalesce(x.body_text, '')) ~* pat
   order by x.received_at desc limit 1;
  if ask.id is null and e.from_email is not null then
    select * into ask from public.emails x
     where x.organization_id = e.organization_id and x.direction = 'out' and x.received_at < e.received_at
       and x.received_at > e.received_at - interval '45 days'
       and (x.to_emails @> array[lower(e.from_email)] or x.cc_emails @> array[lower(e.from_email)])
       and (coalesce(x.subject, '') || ' ' || coalesce(x.body_text, '')) ~* pat
     order by x.received_at desc limit 1;
  end if;
  if ask.id is null then return null; end if;
  -- who asked: sent from VMS, else whose name signs our email (its own part, before any quoted mail)
  who := ask.sent_by;
  if who is null then
    own := coalesce(substring(coalesce(ask.body_text, '') from '^(.*?)\n(On .{4,200}wrote:|-{3,} ?Original Message|_{10,}|From: )'), coalesce(ask.body_text, ''));
    own := right(own, 600);
    select p.id into who from public.profiles p
     where p.organization_id = e.organization_id and p.is_active and p.full_name !~* 'claude'
       and own ~* ('\m' || split_part(p.full_name, ' ', 1) || '\M')
     order by length(own) - strpos(lower(own), lower(split_part(p.full_name, ' ', 1))) asc
     limit 1;
  end if;
  who := coalesce(who, public.org_admin(e.organization_id));
  if who is null then return null; end if;
  select string_agg(distinct case l.kind when 'price_list' then 'price list' when 'catalog' then 'catalog' else 'order form' end, ' and ')
    into kinds from public.vendor_links l where l.email_id = e.id and l.kind in ('price_list', 'catalog', 'order_form');
  select name into vname from public.vendors where id = e.vendor_id;
  insert into public.tasks (organization_id, title, notes, due_date, remind_at, assigned_to, vendor_id, thread_id, area, auto_key)
  values (e.organization_id,
          left(format('%s sent the %s you asked for', coalesce(vname, 'The vendor'), coalesce(kinds, 'price list')), 200),
          format('Your email of %s asked for it; their reply came %s. The files are saved under %s''s %s. Open the reply to finish the order.',
                 to_char(ask.received_at at time zone 'America/Los_Angeles', 'Mon DD, YYYY'),
                 to_char(e.received_at at time zone 'America/Los_Angeles', 'Mon DD, YYYY'),
                 coalesce(vname, 'the vendor'), case when kinds ~ 'catalog' and kinds ~ 'price' then 'Price lists and Catalogs' when kinds ~ 'catalog' then 'Catalogs' when kinds ~ 'order form' then 'Order forms' else 'Price lists' end),
          (e.received_at at time zone 'America/Los_Angeles')::date, case when p_remind then now() end, who, e.vendor_id, e.thread_id, 'general',
          'pricelist:' || e.id)
  on conflict (organization_id, auto_key) where auto_key is not null do nothing
  returning tasks.id into v_task;
  return v_task;
end;
$$;
revoke execute on function public.price_list_reply_task(uuid, boolean) from public, anon, authenticated;
grant execute on function public.price_list_reply_task(uuid, boolean) to service_role;

create or replace function public.vendor_link_price_list_reply() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.kind in ('price_list', 'catalog', 'order_form') and new.email_id is not null then
    perform public.price_list_reply_task(new.email_id, (select received_at > now() - interval '3 days' from public.emails where id = new.email_id));
  end if;
  return null;
end;
$$;
revoke execute on function public.vendor_link_price_list_reply() from public, anon, authenticated;
drop trigger if exists vendor_links_price_list_reply on public.vendor_links;
create trigger vendor_links_price_list_reply after insert on public.vendor_links
  for each row execute function public.vendor_link_price_list_reply();

-- back-check: replies of the last 30 days (no reminder, so no texts for old ones)
do $$
declare r record; n integer := 0;
begin
  for r in select distinct e.id from public.vendor_links l join public.emails e on e.id = l.email_id
            where l.kind in ('price_list', 'catalog', 'order_form') and e.direction = 'in' and e.received_at > now() - interval '30 days' loop
    if public.price_list_reply_task(r.id, false) is not null then n := n + 1; end if;
  end loop;
  raise notice 'price list reply tasks: %', n;
end $$;
