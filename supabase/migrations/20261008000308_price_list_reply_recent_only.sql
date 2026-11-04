-- 0308 — The price list reply alert (0307) only for replies of the last 30 days: the mail sync also files price lists from
--   older mail as it works back through history, and those are not news to anyone.
set local lock_timeout = '5s';

create or replace function public.vendor_link_price_list_reply() returns trigger
language plpgsql security definer set search_path = public as $$
declare at timestamptz;
begin
  if new.kind in ('price_list', 'catalog', 'order_form') and new.email_id is not null then
    select received_at into at from public.emails where id = new.email_id;
    if at > now() - interval '30 days' then
      perform public.price_list_reply_task(new.email_id, at > now() - interval '3 days');
    end if;
  end if;
  return null;
end;
$$;
revoke execute on function public.vendor_link_price_list_reply() from public, anon, authenticated;
