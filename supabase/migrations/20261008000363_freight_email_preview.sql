-- 0363 — Preview of the Freight email (Dana, Nov 13: "We need a preview button so we can see how the links show up").
-- Fills the wording (saved or still being edited) for one order exactly like shipment_request_email does, but writes
-- nothing: no request, no routing-letter record. The "click here" for the routing letter points at a preview address the
-- page does not follow, so clicking it records nothing.
set local lock_timeout = '5s';

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
  select split_part(nullif(trim(coalesce(e.from_name, ve.contact_name, '')), ''), ' ', 1) into v_first
    from (select 1) z left join public.emails e on e.id = v_reply
    left join public.vendor_emails ve on ve.vendor_id = o.vendor_id and lower(ve.email) = v_to[1] and ve.former_at is null limit 1;
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
