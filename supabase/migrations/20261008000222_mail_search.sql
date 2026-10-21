-- 0222 — Mail search (Dana, Oct 21): "you have to be able to search by contact name, vendor name or email, not just
-- subjects. The search bar should bring up names, email addresses, key words, items with attachments vs no attachments."
--
--   • emails.search: the words of each email (subject, sender and recipients with their addresses split into words, the
--     text), kept up to date by a trigger and indexed, so a search over all the mail answers in about a second.
--   • mail_search(q, filters): the conversations whose emails match every word typed, in the text, a name or address, the
--     vendor (and its other names), a contact's name, an attachment's file name, or an order's PO. Each comes back with
--     the email that matched (to open it directly), why it matched and the matching words. Filters: mailbox, with a
--     person, from / to, has or has no attachment, file type, dates, in or out, vendor, rep group, order, what Claude
--     found (confirmation, invoice, shipping notice, artwork). Runs with the caller's own rights: private mailboxes and
--     billing@ stay private.
--   • mail_suggest(q): as you type, people (contacts and senders with their address), vendors, rep groups and POs.

-- never hold up the live mail: give up after 5 seconds if the emails table is busy, and try again
set local lock_timeout = '5s';

-- the words of an address: "sharon.b@lazyone.com" → "sharon b lazyone com"
create or replace function public.addr_words(p text) returns text
language sql immutable parallel safe set search_path = public as $$
  select regexp_replace(coalesce(p, ''), '[@._+\-]+', ' ', 'g')
$$;

alter table public.emails add column if not exists search tsvector;
comment on column public.emails.search is 'Search words: subject (A), sender and recipients with their addresses split into words (B), text (D). Trigger emails_search_doc.';

create or replace function public.emails_search_doc() returns trigger
language plpgsql set search_path = public as $$
declare
  v_people text := concat_ws(' ', new.from_name, new.from_email, public.addr_words(new.from_email),
    array_to_string(new.to_emails, ' '), public.addr_words(array_to_string(new.to_emails, ' ')),
    array_to_string(new.cc_emails, ' '), public.addr_words(array_to_string(new.cc_emails, ' ')),
    new.forwarded_name, new.forwarded_from, public.addr_words(new.forwarded_from));
begin
  new.search := setweight(to_tsvector('simple', coalesce(new.subject, '')), 'A')
    || setweight(to_tsvector('simple', v_people), 'B')
    || setweight(to_tsvector('simple', left(coalesce(nullif(new.body_text, ''), new.snippet, ''), 20000)), 'D');
  return new;
end;
$$;

drop trigger if exists emails_search_doc on public.emails;
create trigger emails_search_doc before insert or update of subject, body_text, snippet, from_name, from_email, to_emails, cc_emails, forwarded_from, forwarded_name
  on public.emails for each row execute function public.emails_search_doc();

-- fill in the mail already here, a batch at a time (all 50,000 at once is too long for one call):
-- select public.emails_search_fill(2000) until it returns 0. Only the search column changes; no other email trigger
-- fires on it.
create or replace function public.emails_search_fill(p_limit int default 2000) returns integer
language plpgsql set search_path = public as $$
declare n integer;
begin
  update public.emails e set search =
      setweight(to_tsvector('simple', coalesce(e.subject, '')), 'A')
   || setweight(to_tsvector('simple', concat_ws(' ', e.from_name, e.from_email, public.addr_words(e.from_email),
        array_to_string(e.to_emails, ' '), public.addr_words(array_to_string(e.to_emails, ' ')),
        array_to_string(e.cc_emails, ' '), public.addr_words(array_to_string(e.cc_emails, ' ')),
        e.forwarded_name, e.forwarded_from, public.addr_words(e.forwarded_from))), 'B')
   || setweight(to_tsvector('simple', left(coalesce(nullif(e.body_text, ''), e.snippet, ''), 20000)), 'D')
   where e.id in (select id from public.emails where search is null limit p_limit);
  get diagnostics n = row_count;
  return n;
end;
$$;
revoke execute on function public.emails_search_fill(int) from public, anon, authenticated;
grant execute on function public.emails_search_fill(int) to service_role;
select public.emails_search_fill(1000000) where (select count(*) from public.emails) < 5000;  -- small databases (tests) fill now

create index if not exists emails_search_idx on public.emails using gin (search);
create index if not exists emails_org_received_idx on public.emails (organization_id, received_at desc);
create index if not exists email_attachments_email_idx on public.email_attachments (email_id);

-- "Sharon's PO 9-28!" → 'sharon:* & s:* & po:* & 9:* & 28:*' (every word, each as the start of a word)
create or replace function public.mail_tsquery(p_q text) returns tsquery
language sql immutable parallel safe set search_path = public as $$
  select case when w is null or w = '' then null else to_tsquery('simple', w) end
  from (select string_agg(t || ':*', ' & ') as w
          from regexp_split_to_table(lower(coalesce(p_q, '')), '[^[:alnum:]]+') as t where t <> '') x
$$;

/**
 * Search the mail. p: { box: 'orders' | mailbox id | 'all', with, from, to, attach: true|false, file: 'pdf'|'sheet'|'picture',
 * since, until (dates), dir: 'in'|'out', vendor_id, rep_group_id, order_id, found: 'confirmation'|'invoice'|'shipping'|'artwork',
 * limit }. One row per conversation: its newest matching email, why it matched, the matching words (<<like this>>).
 */
create or replace function public.mail_search(p_q text, p jsonb default '{}'::jsonb)
returns table (thread_id uuid, email_id uuid, received_at timestamptz, why text, headline text)
language plpgsql stable set search_path = public as $$
declare
  v_org   uuid := public.my_org_id();
  v_q     text := nullif(trim(coalesce(p_q, '')), '');
  v_ts    tsquery := public.mail_tsquery(p_q);
  v_like  text[];
  v_box   text := coalesce(nullif(p->>'box', ''), 'orders');
  v_limit int := least(coalesce((p->>'limit')::int, 200), 500);
  v_addrs text[];   -- addresses of contacts whose name matches
  v_vendors uuid[]; -- vendors whose name or other names match
  v_files uuid[];   -- emails with an attachment whose file name matches
  v_orders uuid[];  -- orders whose PO matches
begin
  if v_org is null then return; end if;
  select array_agg('%' || replace(replace(t, '%', ''), '_', '') || '%') into v_like
    from regexp_split_to_table(lower(coalesce(v_q, '')), '\s+') t where t <> '';
  if v_q is not null then
    select array_agg(distinct lower(x.email)) into v_addrs from (
      select c.email from public.vendor_emails c where c.organization_id = v_org and c.contact_name ilike all (v_like)
      union all select c.email from public.rep_group_contacts c where c.organization_id = v_org and c.email is not null and c.name ilike all (v_like)) x;
    select array_agg(v.id) into v_vendors from public.vendors v
     where v.organization_id = v_org and (v.name ilike all (v_like) or array_to_string(v.aliases, ' ') ilike all (v_like));
    select array_agg(distinct a.email_id) into v_files from public.email_attachments a
     where a.organization_id = v_org and a.file_name ilike all (v_like);
    select array_agg(o.id) into v_orders from public.orders o where o.organization_id = v_org and o.po_number ilike all (v_like);
  end if;

  return query
  with base as (
    select e.* from public.emails e
     where e.organization_id = v_org
       and (v_box = 'all'
            or (v_box = 'orders' and (e.mailbox_id is null or exists (select 1 from public.email_threads t where t.id = e.thread_id and t.shared_at is not null)))
            or (v_box not in ('all', 'orders') and e.mailbox_id::text = v_box))
       and (p->>'since' is null or e.received_at >= (p->>'since')::date)
       and (p->>'until' is null or e.received_at < (p->>'until')::date + 1)
       and (p->>'dir' is null or e.direction = p->>'dir')
       and (p->>'attach' is null or e.has_attachments = (p->>'attach')::boolean)
       and (p->>'from' is null or concat_ws(' ', e.from_name, e.from_email) ilike '%' || (p->>'from') || '%')
       and (p->>'to' is null or array_to_string(e.to_emails || e.cc_emails, ' ') ilike '%' || (p->>'to') || '%')
       and (p->>'with' is null or lower(e.from_email) = lower(p->>'with') or lower(p->>'with') = any (select lower(x) from unnest(e.to_emails || e.cc_emails) x))
       and (p->>'vendor_id' is null or e.vendor_id = (p->>'vendor_id')::uuid
            or exists (select 1 from public.email_threads t where t.id = e.thread_id and (t.vendor_id = (p->>'vendor_id')::uuid or t.tagged_vendor_ids @> array[(p->>'vendor_id')::uuid])))
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
  ), hits as (
    select b.id, b.thread_id, b.received_at, b.body_text, b.snippet,
      case
        when v_q is null then null
        when concat_ws(' ', b.from_name, b.from_email) ilike all (v_like) then 'sender'
        when array_to_string(b.to_emails || b.cc_emails, ' ') ilike all (v_like) then 'sent to'
        when v_addrs is not null and (lower(b.from_email) = any (v_addrs) or exists (select 1 from unnest(b.to_emails || b.cc_emails) x where lower(x) = any (v_addrs))) then 'contact name'
        when v_vendors is not null and b.vendor_id = any (v_vendors) then 'vendor'
        when v_files is not null and b.id = any (v_files) then 'attachment'
        when v_orders is not null and b.order_id = any (v_orders) then 'PO'
        when b.subject ilike all (v_like) then 'subject'
        when v_ts is not null and b.search @@ v_ts then 'text'
        else null
      end as why
    from base b
    where v_q is null
       or (v_ts is not null and b.search @@ v_ts)
       or (v_vendors is not null and b.vendor_id = any (v_vendors))
       or (v_files is not null and b.id = any (v_files))
       or (v_orders is not null and b.order_id = any (v_orders))
       or (v_addrs is not null and (lower(b.from_email) = any (v_addrs) or exists (select 1 from unnest(b.to_emails || b.cc_emails) x where lower(x) = any (v_addrs))))
  ), matched as (
    select distinct on (h.thread_id) h.* from hits h
     where v_q is null or h.why is not null
     order by h.thread_id, h.received_at desc
  ), top as (
    select * from matched order by received_at desc limit v_limit
  )
  select t.thread_id, t.id, t.received_at, t.why,
    case when v_ts is not null and t.why = 'text'
      then ts_headline('simple', left(coalesce(nullif(t.body_text, ''), t.snippet, ''), 4000), v_ts, 'StartSel=<<, StopSel=>>, MaxWords=22, MinWords=10, MaxFragments=1')
      else left(coalesce(t.snippet, ''), 160) end
  from top t order by t.received_at desc;
end;
$$;
grant execute on function public.mail_search(text, jsonb) to authenticated, service_role;
grant execute on function public.mail_tsquery(text) to authenticated, service_role;
grant execute on function public.addr_words(text) to authenticated, service_role;
comment on function public.mail_search(text, jsonb) is 'Mail search: conversations whose emails match every word (text, names, addresses, vendor, contact, attachment, PO) and the filters; newest matching email, why, matching words. Caller''s own rights.';

/** As you type: people (contacts and senders, with their address), vendors, rep groups, POs. */
create or replace function public.mail_suggest(p_q text)
returns table (kind text, id uuid, label text, sub text, address text)
language sql stable set search_path = public as $$
  with w as (select public.my_org_id() as org, '%' || replace(replace(trim(coalesce(p_q, '')), '%', ''), '_', '') || '%' as l
             where length(trim(coalesce(p_q, ''))) >= 2)
  (select 'person', c.id, coalesce(nullif(c.contact_name, ''), c.email), v.name, lower(c.email)
     from w, public.vendor_emails c join public.vendors v on v.id = c.vendor_id
    where c.organization_id = w.org and c.former_at is null and (c.contact_name ilike w.l or c.email ilike w.l)
    order by c.last_mail_at desc nulls last limit 6)
  union all
  (select 'person', c.id, coalesce(nullif(c.name, ''), c.email), g.name, lower(c.email)
     from w, public.rep_group_contacts c join public.rep_groups g on g.id = c.rep_group_id
    where c.organization_id = w.org and c.former_at is null and c.email is not null and (c.name ilike w.l or c.email ilike w.l)
    order by c.last_mail_at desc nulls last limit 4)
  union all
  (select 'person', s.id, coalesce(nullif(s.display_name, ''), s.sender_key), coalesce(s.company_name, 'Sender'), lower(s.sender_key)
     from w, public.email_senders s
    where s.organization_id = w.org and not s.is_domain and (s.display_name ilike w.l or s.sender_key ilike w.l)
    order by s.last_seen_at desc nulls last limit 6)
  union all
  (select 'vendor', v.id, v.name, null, null from w, public.vendors v
    where v.organization_id = w.org and v.merged_into_id is null and (v.name ilike w.l or array_to_string(v.aliases, ' ') ilike w.l)
    order by v.is_active desc, v.name limit 5)
  union all
  (select 'rep_group', g.id, g.name, null, null from w, public.rep_groups g
    where g.organization_id = w.org and g.name ilike w.l order by g.name limit 3)
  union all
  (select 'order', o.id, 'PO ' || o.po_number, v.name, null from w, public.orders o join public.vendors v on v.id = o.vendor_id
    where o.organization_id = w.org and o.po_number ilike w.l order by o.order_date desc nulls last limit 4)
$$;
grant execute on function public.mail_suggest(text) to authenticated, service_role;
comment on function public.mail_suggest(text) is 'Mail search suggestions as you type: people with their address, vendors, rep groups, POs. Caller''s own rights.';
