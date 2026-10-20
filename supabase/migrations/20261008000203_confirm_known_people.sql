-- 0203 — The contact confirmation email goes only to people we know (Dana, Oct 20: "YES"): never former contacts or
-- people only the WWD portal lists (unconfirmed portal contacts stay on the vendor's form, where the people who know
-- can remove them). The form leaves former contacts out, and someone a vendor removes on the form becomes a former
-- contact instead of being deleted, so their old mail can still be found by name.

create or replace function public.vendor_confirm_prepare(p_org uuid, p_vendor uuid default null)
returns integer language plpgsql security definer set search_path = public as $$
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
     where v.organization_id = p_org and v.is_active and v.merged_into_id is null
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
$$;

create or replace function public.vendor_confirm_get(p_token uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  c public.vendor_confirmations%rowtype;
  v public.vendors%rowtype;
begin
  select * into c from public.vendor_confirmations where token = p_token;
  if c.id is null then return null; end if;
  update public.vendor_confirmations set opened_at = coalesce(opened_at, now()) where id = c.id;
  select * into v from public.vendors where id = c.vendor_id;
  return jsonb_build_object(
    'confirmed_at', c.confirmed_at,
    'me_id', c.vendor_email_id,
    'company', jsonb_build_object('name', v.name, 'address', v.address, 'city', v.city, 'state', v.state, 'postal_code', v.postal_code, 'phone', v.phone, 'website', v.website),
    'people', coalesce((select jsonb_agg(jsonb_build_object('id', e.id, 'name', e.contact_name, 'title', e.title, 'email', e.email, 'phones', e.phones, 'roles', e.roles) order by (e.id = c.vendor_email_id) desc, e.contact_name nulls last)
                          from public.vendor_emails e where e.vendor_id = v.id and e.former_at is null and e.email !~* '(no-?reply|do-?not-?reply|notification)'), '[]'::jsonb),
    'order_methods', to_jsonb(v.order_methods),
    'minimum_order', v.minimum_order,
    'freight_programs', coalesce(v.freight_programs_vendor, v.freight_program),
    'categories', coalesce((select jsonb_agg(k.category order by k.category) from public.vendor_sells k where k.vendor_id = v.id), '[]'::jsonb),
    'routing', public.vendor_confirm_routing_state(c.id)
  );
end;
$$;

create or replace function public.vendor_confirm_submit(p_token uuid, p_payload jsonb, p_looks_good boolean)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  c   public.vendor_confirmations%rowtype;
  v   public.vendors%rowtype;
  me  jsonb := coalesce(p_payload->'me', '{}'::jsonb);
  co  jsonb := coalesce(p_payload->'company', '{}'::jsonb);
  p   jsonb;
  x   text;
  v_id uuid;
  v_match uuid;
  v_me uuid;
  unknown text[] := '{}';
begin
  select * into c from public.vendor_confirmations where token = p_token for update;
  if c.id is null then return null; end if;
  select * into v from public.vendors where id = c.vendor_id;
  v_me := c.vendor_email_id;

  if not p_looks_good then
    -- their own details
    if v_me is not null then
      update public.vendor_emails set
        contact_name = coalesce(nullif(trim(me->>'name'), ''), contact_name),
        title = nullif(trim(coalesce(me->>'title', '')), ''),
        phones = coalesce(me->'phones', phones),
        roles = case when jsonb_typeof(me->'roles') = 'array' and jsonb_array_length(me->'roles') > 0
                     then (select array_agg(distinct r::public.contact_type) from jsonb_array_elements_text(me->'roles') r where r in ('rep', 'orders', 'ap', 'customer_service', 'shipping', 'owner', 'other')) else roles end,
        email = case when lower(trim(coalesce(me->>'email', ''))) ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'
                      and not exists (select 1 from public.vendor_emails z where z.vendor_id = c.vendor_id and lower(z.email) = lower(trim(me->>'email')) and z.id <> v_me)
                     then lower(trim(me->>'email')) else email end
       where id = v_me;
    end if;
    -- the company: a new name goes to Dana; the rest lands
    update public.vendors set
      address = coalesce(nullif(trim(co->>'address'), ''), address), city = coalesce(nullif(trim(co->>'city'), ''), city),
      state = coalesce(nullif(trim(co->>'state'), ''), state), postal_code = coalesce(nullif(trim(co->>'postal_code'), ''), postal_code),
      phone = coalesce(nullif(trim(co->>'phone'), ''), phone), website = coalesce(nullif(trim(co->>'website'), ''), website),
      order_methods = case when jsonb_typeof(p_payload->'order_methods') = 'array' then (select coalesce(array_agg(m), '{}') from jsonb_array_elements_text(p_payload->'order_methods') m where m in ('email', 'phone', 'nuorder', 'website')) else order_methods end,
      minimum_order = coalesce(nullif(trim(p_payload->>'minimum_order'), ''), minimum_order),
      freight_programs_vendor = coalesce(nullif(trim(p_payload->>'freight_programs'), ''), freight_programs_vendor)
     where id = v.id;
    if nullif(trim(co->>'name'), '') is not null and lower(trim(co->>'name')) <> lower(v.name) then
      insert into public.review_items (organization_id, kind, entity_type, entity_id, title, details)
      values (v.organization_id, 'vendor_rename', 'vendor', v.id, v.name || ': new company name from their form',
              jsonb_build_object('new_name', trim(co->>'name'), 'reason', coalesce(c.contact_name, c.email) || ' wrote it on our contact form'));
    end if;
    -- coworkers: changes, new people, and people who are gone
    for p in select * from jsonb_array_elements(coalesce(p_payload->'people', '[]'::jsonb)) loop
      if (p->>'id') is not null and (p->>'id') <> coalesce(v_me::text, '') then
        if coalesce((p->>'remove')::boolean, false) then
          -- gone from the company: kept as a former contact so old mail can still be found by name (Dana, Oct 19)
          update public.vendor_emails set former_at = now() where id = (p->>'id')::uuid and vendor_id = v.id and former_at is null;
        else
          update public.vendor_emails set contact_name = coalesce(nullif(trim(p->>'name'), ''), contact_name), title = coalesce(nullif(trim(p->>'title'), ''), title),
                 phones = case when jsonb_typeof(p->'phones') = 'array' and jsonb_array_length(p->'phones') > 0 then p->'phones' else phones end
           where id = (p->>'id')::uuid and vendor_id = v.id;
        end if;
      elsif (p->>'id') is null and lower(trim(coalesce(p->>'email', ''))) ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
        insert into public.vendor_emails (organization_id, vendor_id, email, contact_name, title, phones, contact_type, roles, source, notes)
        values (v.organization_id, v.id, lower(trim(p->>'email')), nullif(trim(p->>'name'), ''), nullif(trim(p->>'title'), ''), coalesce(p->'phones', '[]'::jsonb),
                'other', '{other}', 'vendor_form', 'Added by ' || coalesce(c.contact_name, c.email) || ' on our contact form')
        on conflict do nothing;
      end if;
    end loop;
    -- who gets our POs, freight quotes and tracking, invoices
    perform public.vendor_confirm_role(v, c, p_payload->'po_to', 'orders');
    perform public.vendor_confirm_role(v, c, p_payload->'quotes_to', 'shipping');
    perform public.vendor_confirm_role(v, c, p_payload->'invoices_to', 'ap');
    -- other vendors they represent: known ones get this person as a rep, the rest go to Dana
    for x in select trim(t) from jsonb_array_elements_text(coalesce(p_payload->'represents', '[]'::jsonb)) t where length(trim(t)) > 1 loop
      v_match := public.vendor_by_name(v.organization_id, x);
      if v_match is not null and v_match <> v.id then
        insert into public.vendor_emails (organization_id, vendor_id, email, contact_name, title, phones, contact_type, roles, source, notes, confirmed_at)
        select v.organization_id, v_match, e.email, e.contact_name, e.title, e.phones, 'rep', '{rep}', 'vendor_form', 'Rep for ' || x || ' (from their contact form)', now()
          from public.vendor_emails e where e.id = v_me
        on conflict do nothing;
      elsif v_match is null then
        unknown := unknown || x;
      end if;
    end loop;
    if array_length(unknown, 1) > 0 then
      insert into public.review_items (organization_id, kind, entity_type, entity_id, title, details)
      values (v.organization_id, 'vendor_form', 'vendor', v.id, coalesce(c.contact_name, c.email) || ' (' || v.name || ') also represents vendors not in VMS',
              jsonb_build_object('reason', 'From their contact form: ' || array_to_string(unknown, ', '), 'represents', to_jsonb(unknown), 'email', c.email));
    end if;
    -- what they sell
    if jsonb_typeof(p_payload->'categories') = 'array' then
      delete from public.vendor_sells k where k.vendor_id = v.id
         and not exists (select 1 from jsonb_array_elements_text(p_payload->'categories') t where lower(trim(t)) = lower(k.category));
      insert into public.vendor_sells (organization_id, vendor_id, category, source, confirmed_at)
      select v.organization_id, v.id, trim(t), 'vendor_form', now() from jsonb_array_elements_text(p_payload->'categories') t where length(trim(t)) > 0
      on conflict (vendor_id, lower(category)) do update set confirmed_at = now();
    end if;
  end if;

  update public.vendor_emails set confirmed_at = now(), bad_email_at = null where id = v_me;
  update public.vendor_sells set confirmed_at = now() where vendor_id = v.id;
  update public.vendors set info_confirmed_at = now() where id = v.id;
  update public.vendor_confirmations set confirmed_at = now(), changed = not p_looks_good where id = c.id;
  return jsonb_build_object('vendor', v.name, 'freight_programs', p_payload->>'freight_programs', 'vendor_id', v.id);
end;
$$;
