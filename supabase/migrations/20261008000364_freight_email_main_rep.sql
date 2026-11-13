-- 0364 — The Freight email goes to the vendor's own main rep when there is no shipping, orders or rep-group contact (Nov 13,
-- found in the preview: Paricon's Ted Morton is their rep at Paricon itself, so the email had nobody to go to; 54 of 109
-- open orders had no address). Order: the confirmation's sender, shipping, orders, rep group, our main rep at the vendor
-- (marked Main rep, else their rep we wrote with last), then the vendor's general email.
-- Back-check: requests and unsent Freight email drafts with nobody to go to get the address now.
set local lock_timeout = '5s';

create or replace function public.shipment_request_recipients(p_order uuid, out to_emails text[], out cc_emails text[], out reply_to uuid)
language plpgsql stable security definer set search_path = public as $$
declare o public.orders%rowtype; v public.vendors%rowtype; ours text[]; v_from text; v_email uuid; v_ship text[]; v_orders text[]; v_rep text[]; v_own text[]; v_cc text[];
  bad constant text := '(no-?reply|do-?not-?reply|notification|mailer-daemon)';
begin
  select * into o from public.orders where id = p_order;
  select * into v from public.vendors where id = o.vendor_id;
  select coalesce(array_agg(lower(x)), '{}') into ours from (
    select split_part(mailbox, '@', 2) x from public.mail_accounts where organization_id = o.organization_id
    union select unnest(internal_domains) from public.mail_accounts where organization_id = o.organization_id
    union select 'shaverlakesports.com') d;
  select lower(e.from_email), e.id into v_from, v_email from public.vendor_links l join public.emails e on e.id = l.email_id
   where l.order_id = o.id and l.kind in ('confirmation', 'approved_proof', 'proof') and e.direction = 'in' and e.from_email is not null
   order by (l.kind = 'confirmation') desc, l.created_at desc limit 1;
  if v_from is not null and (split_part(v_from, '@', 2) = any (ours) or v_from ~* bad) then v_from := null; v_email := null; end if;
  select coalesce(array_agg(distinct lower(email)), '{}') into v_ship from public.vendor_emails
   where vendor_id = v.id and email is not null and former_at is null and bad_email_at is null and ('shipping' = any (roles) or contact_type = 'shipping') and email !~* bad;
  select coalesce(array_agg(distinct lower(email)), '{}') into v_orders from public.vendor_emails
   where vendor_id = v.id and email is not null and former_at is null and bad_email_at is null and ('orders' = any (roles) or contact_type = 'orders') and email !~* bad;
  select coalesce(array_agg(distinct lower(c.email)), '{}') into v_rep from public.rep_group_contacts c
   where c.rep_group_id = v.rep_group_id and c.email is not null and c.former_at is null and c.email !~* bad;
  -- our main rep at the vendor itself (Nov 13: Paricon's Ted Morton): the one marked Main rep, else their own reps we wrote
  -- with most recently; never the alternate, a former contact or someone only the WWD portal names
  select coalesce(array_agg(x.email order by x.ord), '{}') into v_own from (
    select lower(c.email) as email, row_number() over (order by (c.id = v.assigned_rep_contact_id) desc, c.last_vendor_mail_at desc nulls last) as ord
      from public.vendor_emails c
     where c.vendor_id = v.id and c.email is not null and c.former_at is null and c.bad_email_at is null and c.email !~* bad
       and c.id is distinct from v.alternate_rep_contact_id
       and (c.id = v.assigned_rep_contact_id or 'rep' = any (c.roles) or c.contact_type = 'rep')
       and not (c.source = 'wwd_portal' and c.kept_at is null and c.confirmed_at is null
                and (c.last_vendor_mail_at is null or c.last_vendor_mail_at < now() - interval '2 years'))
  ) x where x.ord = 1;
  if v_from is not null then to_emails := array[v_from];
  elsif cardinality(v_ship) > 0 then to_emails := v_ship;
  elsif cardinality(v_orders) > 0 then to_emails := v_orders;
  elsif cardinality(v_rep) > 0 then to_emails := v_rep;
  elsif cardinality(v_own) > 0 then to_emails := v_own;
  elsif v.email is not null and v.email !~* bad then to_emails := array[lower(v.email)];
  else to_emails := '{}'; end if;
  select coalesce(array_agg(distinct x), '{}') into v_cc from unnest(v_ship || v_rep) x where not (x = any (to_emails)) and not (split_part(x, '@', 2) = any (ours));
  cc_emails := v_cc;
  reply_to := v_email;
end $$;
revoke execute on function public.shipment_request_recipients(uuid) from public, anon;
grant execute on function public.shipment_request_recipients(uuid) to authenticated, service_role;

update public.shipment_requests s set to_emails = r.to_emails, cc_emails = r.cc_emails, reply_to_email_id = coalesce(s.reply_to_email_id, r.reply_to)
  from public.orders o, public.shipment_request_recipients(o.id) r
 where o.id = s.order_id and cardinality(s.to_emails) = 0 and s.status = 'ready' and cardinality(r.to_emails) > 0;
update public.email_drafts d set to_emails = s.to_emails, cc_emails = s.cc_emails,
       note = replace(d.note, ': no email on file for this vendor, add who it goes to', '')
  from public.shipment_requests s
 where s.review_draft_id = d.id and cardinality(d.to_emails) = 0 and d.gmail_draft_id is null and cardinality(s.to_emails) > 0;
