-- 0225 — Mail search answers in about a second (Oct 21). Run with the caller's rights, the emails table's privacy rule
-- was checked on every one of the 50,000 emails before the search narrowed them (about 20 seconds a query). The search
-- now runs with VMS's rights inside the caller's own organization and applies the very same privacy rule itself, to the
-- emails that match: private mailboxes only for their owner and the admin, billing@ only with Accounting, shared
-- conversations for everyone.

create or replace function public.mail_search(p_q text, p jsonb default '{}'::jsonb)
returns table (thread_id uuid, email_id uuid, received_at timestamptz, why text, headline text)
language plpgsql stable security definer set search_path = public as $$
declare
  v_org     uuid := public.my_org_id();
  v_q       text := nullif(trim(coalesce(p_q, '')), '');
  v_ts      tsquery := public.mail_tsquery(p_q);
  v_like    text[];
  v_box     text := coalesce(nullif(p->>'box', ''), 'orders');
  v_limit   int := least(coalesce((p->>'limit')::int, 200), 500);
  v_with    text := lower(nullif(trim(coalesce(p->>'with', '')), ''));
  v_vendor  uuid := nullif(p->>'vendor_id', '')::uuid;
  v_addrs   text[];  -- addresses of contacts whose name matches
  v_vendors uuid[];  -- vendors whose name or other names match
  v_files   uuid[];  -- emails with an attachment whose file name matches
  v_orders  uuid[];  -- orders whose PO matches
  v_ids     uuid[];  -- the emails that can match
begin
  if v_org is null then return; end if;
  if v_q is not null then
    select array_agg('%' || replace(replace(t, '%', ''), '_', '') || '%') into v_like
      from regexp_split_to_table(lower(v_q), '\s+') t where t <> '';
    select array_agg(distinct lower(x.email)) into v_addrs from (
      select c.email from public.vendor_emails c where c.organization_id = v_org and c.contact_name ilike all (v_like)
      union all select c.email from public.rep_group_contacts c where c.organization_id = v_org and c.email is not null and c.name ilike all (v_like)) x;
    select array_agg(v.id) into v_vendors from public.vendors v
     where v.organization_id = v_org and (v.name ilike all (v_like) or array_to_string(v.aliases, ' ') ilike all (v_like));
    select array_agg(distinct a.email_id) into v_files from public.email_attachments a
     where a.organization_id = v_org and a.file_name ilike all (v_like);
    select array_agg(o.id) into v_orders from public.orders o where o.organization_id = v_org and o.po_number ilike all (v_like);
    select array_agg(distinct x.id) into v_ids from (
      select e.id from public.emails e where e.organization_id = v_org and v_ts is not null and e.search @@ v_ts
      union all select e.id from public.emails e where v_vendors is not null and e.vendor_id = any (v_vendors)
      union all select unnest(v_files)
      union all select e.id from public.emails e where v_orders is not null and e.order_id = any (v_orders)
      union all select e.id from public.emails e where v_addrs is not null and e.organization_id = v_org and lower(e.from_email) = any (v_addrs)
      union all select e.id from public.emails e where v_addrs is not null and (e.to_emails && v_addrs or e.cc_emails && v_addrs)) x;
    if v_ids is null then return; end if;
  elsif v_with is not null then
    select array_agg(e.id) into v_ids from public.emails e
     where e.organization_id = v_org and (lower(e.from_email) = v_with or e.to_emails @> array[v_with] or e.cc_emails @> array[v_with]);
    if v_ids is null then return; end if;
  end if;

  return query
  with base as (
    select e.id, e.thread_id, e.received_at from public.emails e
     where e.organization_id = v_org
       and (v_ids is null or e.id = any (v_ids))
       -- the same rule as the emails table's own privacy rule (0002 + 0065 + 0113): private mailboxes only for their
       -- owner and the admin, billing@ only for those who see Accounting, shared conversations for everyone
       and public.user_in_org(e.organization_id)
       and (e.mailbox_id is null or public.can_see_mailbox(e.mailbox_id)
            or exists (select 1 from public.email_threads t where t.id = e.thread_id and t.shared_at is not null))
       and (v_box = 'all'
            or (v_box = 'orders' and (e.mailbox_id is null or exists (select 1 from public.email_threads t where t.id = e.thread_id and t.shared_at is not null)))
            or (v_box not in ('all', 'orders') and e.mailbox_id::text = v_box))
       and (p->>'since' is null or e.received_at >= (p->>'since')::date)
       and (p->>'until' is null or e.received_at < (p->>'until')::date + 1)
       and (p->>'dir' is null or e.direction = p->>'dir')
       and (p->>'attach' is null or e.has_attachments = (p->>'attach')::boolean)
       and (p->>'from' is null or concat_ws(' ', e.from_name, e.from_email) ilike '%' || (p->>'from') || '%')
       and (p->>'to' is null or array_to_string(e.to_emails || e.cc_emails, ' ') ilike '%' || (p->>'to') || '%')
       and (v_with is null or lower(e.from_email) = v_with or e.to_emails @> array[v_with] or e.cc_emails @> array[v_with])
       and (v_vendor is null or e.vendor_id = v_vendor
            or exists (select 1 from public.email_threads t where t.id = e.thread_id and (t.vendor_id = v_vendor or t.tagged_vendor_ids @> array[v_vendor])))
       and (p->>'rep_group_id' is null or exists (select 1 from public.email_senders s where s.id = e.sender_id and s.rep_group_id = (p->>'rep_group_id')::uuid))
       and (p->>'order_id' is null or e.order_id = (p->>'order_id')::uuid)
       and (p->>'file' is null or exists (select 1 from public.email_attachments a where a.email_id = e.id and case p->>'file'
              when 'pdf' then a.mime_type ilike '%pdf%' or a.file_name ilike '%.pdf'
              when 'sheet' then a.mime_type ~* '(spreadsheet|excel|csv)' or a.file_name ~* '\.(xlsx?|csv)$'
              when 'picture' then a.mime_type ilike 'image/%'
              else true end))
       and (p->>'found' is null or case p->>'found'
              when 'confirmation' then exists (select 1 from public.order_checks c where c.email_id = e.id and c.kind = 'confirmation')
              when 'invoice' then exists (select 1 from public.order_checks c where c.email_id = e.id and c.kind = 'invoice')
              when 'shipping' then e.ship_status is not null
              when 'artwork' then e.art_needed = 'yes'
              else true end)
     order by e.received_at desc
     limit case when v_ids is null then 3000 else 20000 end
  ), latest as (
    select distinct on (b.thread_id) b.* from base b order by b.thread_id, b.received_at desc
  ), top as (
    select l.* from latest l order by l.received_at desc limit v_limit
  ), why as (
    select t.thread_id, t.id, t.received_at, e.body_text, e.snippet,
      case
        when v_q is null then null
        when concat_ws(' ', e.from_name, e.from_email) ilike all (v_like) then 'sender'
        when array_to_string(e.to_emails || e.cc_emails, ' ') ilike all (v_like) then 'sent to'
        when v_addrs is not null and (lower(e.from_email) = any (v_addrs) or e.to_emails && v_addrs or e.cc_emails && v_addrs) then 'contact name'
        when v_vendors is not null and e.vendor_id = any (v_vendors) then 'vendor'
        when v_files is not null and e.id = any (v_files) then 'attachment'
        when v_orders is not null and e.order_id = any (v_orders) then 'PO'
        when e.subject ilike all (v_like) then 'subject'
        else 'text'
      end as why
    from top t join public.emails e on e.id = t.id
  )
  select w.thread_id, w.id, w.received_at, w.why,
    case when v_ts is not null and w.why = 'text'
      then ts_headline('simple', left(coalesce(nullif(w.body_text, ''), w.snippet, ''), 4000), v_ts, 'StartSel=<<, StopSel=>>, MaxWords=22, MinWords=10, MaxFragments=1')
      else left(coalesce(w.snippet, ''), 160) end
  from why w order by w.received_at desc;
end;
$$;
revoke execute on function public.mail_search(text, jsonb) from public, anon;
grant execute on function public.mail_search(text, jsonb) to authenticated, service_role;
