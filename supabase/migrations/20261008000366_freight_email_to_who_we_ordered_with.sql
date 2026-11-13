-- 0366 — Who the Freight email goes to (Dana, Nov 13: "the freight email should always go to the person we placed the order
-- with because they are usually the ones who will send it off for fulfillment and shipping. we dont send anything directly
-- to their freight dept unless they emailed us about something" … "go").
--   To: whoever our latest order email on this order went to (re-sent to someone else: that person). Not found on the
--   order (orders from Dana's sheets): our latest email to the vendor in Orders mail naming the PO. Neither: our main rep
--   (marked Main rep, else the rep group's rep, else their own rep we wrote with last; never the alternate or a former
--   contact), then the vendor's general email.
--   Cc: only their shipping or freight people who emailed us about this order. Nobody else.
--   The draft answers their confirmation only when it came from the person it goes to.
-- Back-check: freight email requests not sent yet, and their unsent drafts, are re-addressed.
set local lock_timeout = '5s';

create or replace function public.shipment_request_recipients(p_order uuid, out to_emails text[], out cc_emails text[], out reply_to uuid)
language plpgsql stable security definer set search_path = public as $$
declare o public.orders%rowtype; v public.vendors%rowtype; ours text[]; v_to text[]; v_po text; v_conf uuid; v_conf_from text;
  bad constant text := '(no-?reply|do-?not-?reply|notification|mailer-daemon)';
begin
  select * into o from public.orders where id = p_order;
  select * into v from public.vendors where id = o.vendor_id;
  to_emails := '{}'; cc_emails := '{}'; reply_to := null;
  if o.id is null then return; end if;
  select coalesce(array_agg(lower(x)), '{}') into ours from (
    select split_part(mailbox, '@', 2) x from public.mail_accounts where organization_id = o.organization_id
    union select unnest(internal_domains) from public.mail_accounts where organization_id = o.organization_id
    union select 'shaverlakesports.com') d;
  -- 1. the person we placed the order with: our latest order email on this order (not the freight email itself)
  select e.to_emails into v_to from public.emails e
   where e.order_id = o.id and e.direction = 'out' and cardinality(e.to_emails) > 0
     and not exists (select 1 from public.shipment_requests s where s.sent_email_id = e.id)
     and coalesce(e.subject, '') !~* '^(re: *)?freight for our po'
   order by e.received_at desc limit 1;
  select coalesce(array_agg(distinct lower(x)), '{}') into v_to from unnest(coalesce(v_to, '{}')) x
   where not (split_part(lower(x), '@', 2) = any (ours)) and x !~* bad;
  -- 2. not on the order (Dana's sheets): our email to the vendor in Orders mail naming the PO
  v_po := nullif(trim(o.po_number), '');
  if cardinality(v_to) = 0 and length(coalesce(v_po, '')) >= 4 then
    select e.to_emails into v_to from public.emails e left join public.email_threads t on t.id = e.thread_id
     where e.organization_id = o.organization_id and e.direction = 'out' and cardinality(e.to_emails) > 0
       and (e.vendor_id = o.vendor_id or t.vendor_id = o.vendor_id)
       and (e.mailbox_id is null or t.shared_at is not null)
       and (strpos(lower(coalesce(e.subject, '')), lower(v_po)) > 0 or strpos(lower(coalesce(e.body_text, '')), lower(v_po)) > 0)
       and coalesce(e.subject, '') !~* '^(re: *)?freight for our po'
     order by e.received_at desc limit 1;
    select coalesce(array_agg(distinct lower(x)), '{}') into v_to from unnest(coalesce(v_to, '{}')) x
     where not (split_part(lower(x), '@', 2) = any (ours)) and x !~* bad;
  end if;
  -- 3. our main rep
  if cardinality(v_to) = 0 then
    select array[lower(c.email)] into v_to from public.vendor_emails c
     where c.id = v.assigned_rep_contact_id and c.email is not null and c.former_at is null and c.bad_email_at is null;
  end if;
  if cardinality(coalesce(v_to, '{}')) = 0 then
    select array[lower(c.email)] into v_to from public.rep_group_contacts c
     where c.email is not null and c.former_at is null and c.email !~* bad
       and (c.id = v.assigned_rep_group_contact_id or (v.assigned_rep_contact_id is null and v.assigned_rep_group_contact_id is null and c.rep_group_id = v.rep_group_id))
       and c.id is distinct from v.alternate_rep_group_contact_id
     order by (c.id = v.assigned_rep_group_contact_id) desc, c.last_mail_at desc nulls last limit 1;
  end if;
  if cardinality(coalesce(v_to, '{}')) = 0 then
    select array[lower(c.email)] into v_to from public.vendor_emails c
     where c.vendor_id = v.id and c.email is not null and c.former_at is null and c.bad_email_at is null and c.email !~* bad
       and c.id is distinct from v.alternate_rep_contact_id and ('rep' = any (c.roles) or c.contact_type = 'rep')
       and not (c.source = 'wwd_portal' and c.kept_at is null and c.confirmed_at is null
                and (c.last_vendor_mail_at is null or c.last_vendor_mail_at < now() - interval '2 years'))
     order by c.last_vendor_mail_at desc nulls last limit 1;
  end if;
  if cardinality(coalesce(v_to, '{}')) = 0 and v.email is not null and v.email !~* bad then v_to := array[lower(v.email)]; end if;
  to_emails := coalesce(v_to, '{}');
  -- Cc: their shipping or freight people who emailed us about this order
  select coalesce(array_agg(distinct lower(c.email)), '{}') into cc_emails from public.vendor_emails c
   where c.vendor_id = v.id and c.email is not null and c.former_at is null and c.bad_email_at is null
     and ('shipping' = any (c.roles) or c.contact_type = 'shipping' or c.id = v.main_shipping_contact_id)
     and not (lower(c.email) = any (to_emails))
     and exists (select 1 from public.emails e where e.direction = 'in' and lower(e.from_email) = lower(c.email)
                  and (e.order_id = o.id or e.thread_id in (select x.thread_id from public.emails x where x.order_id = o.id and x.thread_id is not null)));
  -- answer their confirmation only when it came from the person it goes to
  select e.id, lower(e.from_email) into v_conf, v_conf_from from public.vendor_links l join public.emails e on e.id = l.email_id
   where l.order_id = o.id and l.kind = 'confirmation' and e.direction = 'in' and e.from_email is not null
   order by l.created_at desc limit 1;
  if v_conf_from = any (to_emails) then reply_to := v_conf; end if;
end $$;
revoke execute on function public.shipment_request_recipients(uuid) from public, anon;
grant execute on function public.shipment_request_recipients(uuid) to authenticated, service_role;

/** First name for "Hi …": the email they wrote, else their contact card (the vendor's or the rep group's). */
create or replace function public.freight_first_name(p_vendor uuid, p_email text, p_reply uuid) returns text
language sql stable security definer set search_path = public as $$
  select split_part(nullif(trim(coalesce(
           (select e.from_name from public.emails e where e.id = p_reply and lower(e.from_email) = lower(p_email)),
           (select c.contact_name from public.vendor_emails c where c.vendor_id = p_vendor and lower(c.email) = lower(p_email) and c.former_at is null limit 1),
           (select c.name from public.rep_group_contacts c join public.vendors v on v.rep_group_id = c.rep_group_id
             where v.id = p_vendor and lower(c.email) = lower(p_email) and c.former_at is null limit 1),
           '')), ''), ' ', 1)
$$;
revoke execute on function public.freight_first_name(uuid, text, uuid) from public, anon, authenticated;

create or replace function public.shipment_request_email(p_req uuid)
returns table (subject text, body text, to_emails text[], cc_emails text[], reply_to_email_id uuid, thread_id uuid, send_as uuid, vendor_id uuid, order_id uuid, attach_routing_letter boolean)
language plpgsql security definer set search_path = public as $$
declare s public.shipment_requests%rowtype; o public.orders%rowtype; v public.vendors%rowtype; t public.message_templates%rowtype;
        v_first text; v_po text; v_link text; v_subj text; v_body text; v_letter uuid; v_send uuid; v_tok uuid;
begin
  select * into s from public.shipment_requests x where x.id = p_req;
  if s.id is null then return; end if;
  select * into o from public.orders x where x.id = s.order_id;
  select * into v from public.vendors x where x.id = s.vendor_id;
  select * into t from public.message_templates x where x.organization_id = s.organization_id and x.key = 'freight_email';
  v_po := coalesce(nullif(trim(o.po_number), ''), '');
  v_first := public.freight_first_name(s.vendor_id, s.to_emails[1], s.reply_to_email_id);
  v_link := 'https://vms.shaverlakesports.com/ship/' || s.token;
  -- the routing letter rides along; the first person it goes to gets a "click here" that records they have it (no reminder)
  select x.id into v_letter from public.routing_letters x where x.organization_id = s.organization_id order by x.version desc limit 1;
  if v_letter is not null and cardinality(s.to_emails) > 0 then
    insert into public.routing_letter_sends (organization_id, letter_id, vendor_id, contact_name, email, reminded_at)
    values (s.organization_id, v_letter, s.vendor_id, nullif(v_first, ''), lower(s.to_emails[1]), now())
    on conflict (letter_id, email) do nothing;
    select x.id, x.token into v_send, v_tok from public.routing_letter_sends x where x.letter_id = v_letter and x.email = lower(s.to_emails[1]);
    update public.shipment_requests set routing_send_id = v_send where id = s.id and routing_send_id is distinct from v_send;
  end if;
  v_subj := replace(replace(coalesce(nullif(t.subject, ''), 'Freight for our PO {po} – Shaver Lake Sports'), '{po}', v_po), '{vendor}', coalesce(v.name, ''));
  v_body := coalesce(t.body, '');
  if v_tok is null then v_body := replace(replace(v_body, '[click here]({receipt_link})', 'reply to this email'), '[Click here]({receipt_link})', 'reply to this email'); end if;
  v_body := replace(replace(replace(replace(replace(v_body,
              '{first_name}', coalesce(nullif(v_first, ''), 'there')),
              '{po}', v_po), '{vendor}', coalesce(v.name, '')),
              '{form_link}', v_link),
              '{receipt_link}', coalesce('https://vms.shaverlakesports.com/r/' || v_tok, ''));
  return query select v_subj, v_body, s.to_emails, s.cc_emails, s.reply_to_email_id, (select e.thread_id from public.emails e where e.id = s.reply_to_email_id), s.send_as, s.vendor_id, s.order_id,
                      v_letter is not null;
end $$;
revoke execute on function public.shipment_request_email(uuid) from public, anon;
grant execute on function public.shipment_request_email(uuid) to authenticated, service_role;

create or replace function public.freight_email_preview(p_order uuid, p_subject text, p_body text)
returns table (subject text, body text, to_emails text[], form_ready boolean, has_letter boolean)
language plpgsql stable security definer set search_path = public as $$
declare o public.orders%rowtype; v public.vendors%rowtype; s public.shipment_requests%rowtype; r record;
        v_to text[]; v_reply uuid; v_first text; v_po text; v_link text; v_subj text; v_body text; v_letter boolean;
begin
  select * into o from public.orders x where x.id = p_order;
  if o.id is null or not public.user_in_org(o.organization_id) then raise exception 'Order not found' using errcode = '42501'; end if;
  select * into v from public.vendors x where x.id = o.vendor_id;
  select * into s from public.shipment_requests x where x.order_id = o.id;
  if s.id is not null and cardinality(s.to_emails) > 0 then v_to := s.to_emails; v_reply := s.reply_to_email_id;
  else select * into r from public.shipment_request_recipients(o.id); v_to := coalesce(r.to_emails, '{}'); v_reply := r.reply_to;
  end if;
  v_po := coalesce(nullif(trim(o.po_number), ''), '');
  v_first := public.freight_first_name(o.vendor_id, v_to[1], v_reply);
  v_link := 'https://vms.shaverlakesports.com/ship/' || coalesce(s.token::text, 'new');
  v_letter := exists (select 1 from public.routing_letters x where x.organization_id = o.organization_id) and cardinality(v_to) > 0;
  v_subj := replace(replace(coalesce(nullif(p_subject, ''), 'Freight for our PO {po} – Shaver Lake Sports'), '{po}', v_po), '{vendor}', coalesce(v.name, ''));
  v_body := coalesce(p_body, '');
  if not v_letter then v_body := replace(replace(v_body, '[click here]({receipt_link})', 'reply to this email'), '[Click here]({receipt_link})', 'reply to this email'); end if;
  v_body := replace(replace(replace(replace(replace(v_body,
              '{first_name}', coalesce(nullif(v_first, ''), 'there')),
              '{po}', v_po), '{vendor}', coalesce(v.name, '')),
              '{form_link}', v_link),
              '{receipt_link}', 'https://vms.shaverlakesports.com/r/preview');
  return query select v_subj, v_body, v_to, s.token is not null, v_letter;
end $$;
revoke execute on function public.freight_email_preview(uuid, text, text) from public, anon;
grant execute on function public.freight_email_preview(uuid, text, text) to authenticated;

-- ---- back-check: freight emails not sent yet go to the new people -------------------------------------------------------
with x as (
  select s.id, s.review_draft_id, r.to_emails, r.cc_emails, r.reply_to
    from public.shipment_requests s join public.orders o on o.id = s.order_id, public.shipment_request_recipients(o.id) r
   where s.status = 'ready' and (s.to_emails is distinct from r.to_emails or s.cc_emails is distinct from r.cc_emails)
), req as (
  update public.shipment_requests s set to_emails = x.to_emails, cc_emails = x.cc_emails, reply_to_email_id = x.reply_to
    from x where x.id = s.id returning s.id
)
update public.email_drafts d set to_emails = x.to_emails, cc_emails = x.cc_emails, reply_to_email_id = x.reply_to,
       thread_id = (select e.thread_id from public.emails e where e.id = x.reply_to),
       note = replace(d.note, ': no email on file for this vendor, add who it goes to', '')
  from x where x.review_draft_id = d.id and d.gmail_draft_id is null;
