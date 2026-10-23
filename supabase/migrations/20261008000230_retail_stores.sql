-- 0230 — Retail stores (Dana, Oct 23): "anything like Amazon, Mtn Milk & Cream, Costco, Walmart, smart n final should be
-- ignored. They are obviously not WWD and are main stream stores that we aren't going to send emails to update their
-- info." A Retail store tick on the vendor: never on the inactive list, never sent the contact update email, never a
-- contact review card. Their orders, sales and purchases show as before. Ticked: Amazon, Costco, Dollar Store, Home
-- Depot, Mountain Milk & Cream, Sam's Club, Smart N Final, Walmart and Frito-Lay.

set local lock_timeout = '5s';

alter table public.vendors add column if not exists is_retail_store boolean not null default false;
comment on column public.vendors.is_retail_store is 'A retail store or local supplier we buy from (Costco, Walmart…): no contact update email, no contact review cards, never on the inactive list.';

CREATE OR REPLACE FUNCTION public.vendor_confirm_prepare(p_org uuid, p_vendor uuid DEFAULT NULL::uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  r record;
  o public.organizations%rowtype;
  v_id uuid;
  v_draft uuid;
  n integer := 0;
begin
  if not (public.user_in_org(p_org) and public.user_can_edit()) then raise exception 'Only admins, managers and buyers send these' using errcode = '42501'; end if;
  select * into o from public.organizations where id = p_org;
  for r in
    select distinct on (ve.vendor_id, lower(ve.email)) ve.id, ve.vendor_id, lower(ve.email) as email, ve.contact_name, v.name as vendor_name
      from public.vendor_emails ve join public.vendors v on v.id = ve.vendor_id
     where v.organization_id = p_org and v.is_active and v.merged_into_id is null and not v.is_retail_store
       and (p_vendor is null or v.id = p_vendor)
       and (p_vendor is not null or exists (select 1 from public.orders x where x.vendor_id = v.id))
       and ve.email is not null and ve.bad_email_at is null
       -- only people we know (Dana, Oct 20): never former contacts or ones only the WWD portal lists
       and ve.former_at is null and not public.portal_contact_unconfirmed(ve)
       and ve.email !~* '(no-?reply|do-?not-?reply|notification|mailer-daemon)'
       and (ve.confirmed_at is null or ve.confirmed_at < now() - interval '365 days')
       and not exists (select 1 from public.vendor_confirmations c where c.vendor_id = v.id and c.email = lower(ve.email) and c.confirmed_at is null and c.bounced_at is null)
     order by ve.vendor_id, lower(ve.email), ve.created_at
  loop
    insert into public.vendor_confirmations (organization_id, vendor_id, vendor_email_id, email, contact_name)
    values (p_org, r.vendor_id, r.id, r.email, r.contact_name)
    on conflict do nothing
    returning id into v_id;
    continue when v_id is null;
    insert into public.email_drafts (organization_id, owner_id, created_by, to_emails, subject, body, vendor_id, note, confirmation_id)
    values (p_org, auth.uid(), auth.uid(), array[r.email], o.confirm_email_subject,
            replace(replace(o.confirm_email_body, '{first_name}', coalesce(split_part(nullif(trim(r.contact_name), ''), ' ', 1), 'there')),
                    '{form_link}', 'https://vms.shaverlakesports.com/confirm/' || (select token from public.vendor_confirmations where id = v_id)),
            r.vendor_id, 'Contact confirmation for ' || r.vendor_name, v_id)
    returning id into v_draft;
    update public.vendor_confirmations set draft_id = v_draft where id = v_id;
    n := n + 1;
  end loop;
  return n;
end;
$function$;

CREATE OR REPLACE FUNCTION public.portal_contacts_review(p_org uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare n_new integer; n_done integer;
begin
  insert into public.review_items (organization_id, kind, entity_type, entity_id, title, details)
  select v.organization_id, 'portal_contact', 'vendor', v.id,
         format('%s: %s WWD portal contact%s to check', v.name, count(*), case when count(*) = 1 then '' else 's' end),
         jsonb_build_object('vendor_id', v.id, 'vendor_name', v.name, 'vendor_id_for_rules', v.id)
    from public.vendor_emails ve join public.vendors v on v.id = ve.vendor_id and v.is_active
   where v.organization_id = p_org and not v.is_retail_store and public.portal_contact_unconfirmed(ve)
     and not exists (select 1 from public.review_items r where r.kind = 'portal_contact' and r.entity_id = v.id and r.status = 'pending')
   group by v.organization_id, v.id, v.name;
  get diagnostics n_new = row_count;
  update public.review_items r set status = 'accepted', resolved_at = now(), resolution_note = 'All checked'
   where r.organization_id = p_org and r.kind = 'portal_contact' and r.status = 'pending'
     and (not exists (select 1 from public.vendor_emails ve where ve.vendor_id = r.entity_id and public.portal_contact_unconfirmed(ve))
          or exists (select 1 from public.vendors x where x.id = r.entity_id and x.is_retail_store));
  get diagnostics n_done = row_count;
  return jsonb_build_object('cards_new', n_new, 'cards_done', n_done);
end;
$function$;


update public.vendors set is_retail_store = true
 where merged_into_id is null and upper(name) in ('AMAZON', 'COSTCO', 'DOLLAR STORE', 'HOME DEPOT', 'MOUNTAIN MILK & CREAM', 'SAMS CLUB', 'SMART N FINAL', 'WALMART', 'FRITO-LAY');
-- their open contact cards close
update public.review_items r set status = 'rejected', resolved_at = now(), resolution_note = 'Retail store: no contact check'
  from public.vendors v where v.id = r.entity_id and v.is_retail_store and r.kind = 'portal_contact' and r.status = 'pending';
