-- 0111 — Forwarded vendor mail (Dana, Oct 15): "How do we get Claude to handle a forwarded invoice or confirmation from a
-- vendor who sent it to the old Gmail or even to my billing email or Jarrett's email?"
-- • organizations.own_addresses: our addresses outside the shaverlakesports.com domain (the old Gmail, billing@, staff's
--   own Gmail). Mail from them is ours, never a "Who is this?" sender.
-- • emails.forwarded_from / forwarded_name: the vendor a forwarded email came from (its "From:" line). The email is filed to
--   that vendor and handled like the vendor's own email: paperwork, orders, pictures.

alter table public.organizations add column if not exists own_addresses text[] not null default '{}';
comment on column public.organizations.own_addresses is 'Our own addresses outside our domain (old Gmail, billing@, staff Gmail): our mail, never a vendor (Dana, Oct 15).';
update public.organizations set own_addresses = array['shaverlakesports@gmail.com', 'billing.slsports@gmail.com', 'jarrettwbusiness@gmail.com',
  'trevor.shaverlakesports@gmail.com', 'danapowell2024@gmail.com', 'shaverlakesportssheets@gmail.com', 'shaverlakemarina@gmail.com']
 where id = '00000000-0000-0000-0000-000000000001';

alter table public.emails add column if not exists forwarded_from text;
alter table public.emails add column if not exists forwarded_name text;
comment on column public.emails.forwarded_from is 'A vendor email forwarded to us from one of our addresses: the original sender (its From: line).';

-- Our own addresses are ours: no sender card asks who they are.
update public.email_senders s set kind = 'internal'
  from public.organizations o
 where o.id = s.organization_id and s.sender_key = any (o.own_addresses) and s.kind in ('unknown', 'not_vendor');
update public.review_items r set status = 'rejected', resolved_at = now()
  from public.email_senders s join public.organizations o on o.id = s.organization_id
 where r.id = s.review_item_id and s.sender_key = any (o.own_addresses) and r.status = 'pending';
