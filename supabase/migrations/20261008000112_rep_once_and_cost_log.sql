-- 112: a rep is entered once (Dana, Oct 16: "I need a way to only have to enter it once") and the Claude cost log
-- counts every billed call.
--
-- 1. vendor_contact_to_rep_group(contact): a rep typed on a vendor that buys through a rep group moves onto the rep
--    group, so they show on every vendor the group reps. The same address on the group's other vendors folds in too,
--    and a vendor whose main rep they were keeps them as its main rep.
-- 2. contact_domain_known(email, vendor, group): the address is at a company VMS already knows for that vendor or rep
--    group (another of its people, its website or email). Contact learning counts such a person as theirs without
--    asking Claude (Claude had said Travis at JRA Sales, tanderson@jrasales.com, was "not JRA Sales").
-- 3. ai_usage.request_id: Claude's id for the call. Every billed answer is logged once, also calls whose answer could
--    not be used and freight readings, which were missing (VMS showed $9.52 for a day Anthropic billed about $15).

alter table public.ai_usage add column if not exists request_id text;
do $$ begin
  alter table public.ai_usage add constraint ai_usage_request_id_key unique (request_id);
exception when duplicate_object or duplicate_table then null;
end $$;
comment on column public.ai_usage.request_id is 'Claude''s message id: the call is logged once, by its purpose, or as "not_logged" when only the client saw it.';

create or replace function public.contact_domain_known(p_email text, p_vendor uuid, p_group uuid)
returns boolean
language sql stable security definer set search_path = public as $$
  with d as (select public.mail_domain(p_email) as dom)
  select coalesce((
    select d.dom is not null and not public.mail_is_freemail(d.dom) and (
         exists (select 1 from public.vendor_emails ve where ve.vendor_id = p_vendor and public.mail_domain(ve.email) = d.dom and lower(ve.email) <> lower(p_email))
      or exists (select 1 from public.vendors v where v.id = p_vendor and (public.mail_domain(v.email) = d.dom or v.website ilike '%' || d.dom || '%'))
      or exists (select 1 from public.rep_group_contacts c where c.rep_group_id = p_group and public.mail_domain(c.email) = d.dom and lower(c.email) <> lower(p_email))
      or exists (select 1 from public.rep_groups g where g.id = p_group and (public.mail_domain(g.email) = d.dom or g.website ilike '%' || d.dom || '%'))
      or exists (select 1 from public.vendor_emails ve join public.vendors v on v.id = ve.vendor_id
                  where p_group is not null and v.rep_group_id = p_group and public.mail_domain(ve.email) = d.dom and lower(ve.email) <> lower(p_email)))
    from d), false)
$$;
grant execute on function public.contact_domain_known(text, uuid, uuid) to authenticated, service_role;

create or replace function public.vendor_contact_to_rep_group(p_contact uuid)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  c public.vendor_emails;
  g uuid;
  gid uuid;
  same uuid[];
begin
  select * into c from public.vendor_emails where id = p_contact;
  if not found then raise exception 'That contact is gone'; end if;
  if auth.uid() is not null and not (public.user_in_org(c.organization_id) and public.user_can_edit()) then raise exception 'Not allowed'; end if;
  select rep_group_id into g from public.vendors where id = c.vendor_id;
  if g is null then raise exception 'This vendor does not buy through a rep group'; end if;

  if c.email is not null then
    select id into gid from public.rep_group_contacts where rep_group_id = g and lower(email) = lower(c.email) limit 1;
  end if;
  if gid is null then
    insert into public.rep_group_contacts (organization_id, rep_group_id, name, title, email, phone, phones, notes)
    values (c.organization_id, g, c.contact_name, c.title, lower(c.email), c.phone, coalesce(c.phones, '[]'::jsonb), c.notes)
    returning id into gid;
  else
    update public.rep_group_contacts
       set name = coalesce(name, c.contact_name), title = coalesce(title, c.title), phone = coalesce(phone, c.phone),
           phones = case when coalesce(jsonb_array_length(phones), 0) = 0 then coalesce(c.phones, '[]'::jsonb) else phones end
     where id = gid;
  end if;

  -- this card and the same person on the group's other vendors
  select array_agg(ve.id) into same
    from public.vendor_emails ve join public.vendors v on v.id = ve.vendor_id
   where ve.id = c.id or (c.email is not null and v.rep_group_id = g and lower(ve.email) = lower(c.email));
  update public.vendors set assigned_rep_group_contact_id = gid, assigned_rep_contact_id = null where assigned_rep_contact_id = any (same);
  delete from public.vendor_emails where id = any (same);
  return gid;
end;
$$;
revoke execute on function public.vendor_contact_to_rep_group(uuid) from public, anon;
grant execute on function public.vendor_contact_to_rep_group(uuid) to authenticated, service_role;
