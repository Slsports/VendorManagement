-- 0265 — Dana, Oct 28: "the Attach from vendor system is completely disfunctional … How am I supposed to know what to
-- attach?? … we need to maybe do some renaming of files when they arrive so we know exactly what they are, while still
-- keeping the name, or part of the name that the vendor listed." And: "if there is more than one person that our vendor
-- sent the email to, does the system do a 'reply all' when creating a draft? It needs too."
--
--   • Paperwork files (confirmations, invoices, credits, our orders, shipping papers, payments) are named
--     "<what it is> <its number> – <the vendor's own name for it> – <date>" when they land and whenever VMS reads the
--     number or date, e.g. "Confirmation – SO-88198 – Feb 28, 2026". The vendor's name is kept in vendor_links.orig_label
--     (and the file name itself never changes). A file someone renames by hand keeps that name.
--     Back-check: every paperwork file already filed, for every vendor (counts in docs/decisions.md).
--   • Drafts keep the vendor files picked to go with them (email_drafts.vendor_link_ids); a credit follow-up carries the
--     files our first request had.
--   • A draft VMS writes in a conversation goes to everyone on the vendor's email it answers (from, to and cc), except
--     our own addresses: reply all. Back-check: the drafts waiting now (the two Planet Cotton freight-quote asks were
--     missing Maryellen). Dana's own draft to Maria (SO 88198) is left alone at her request.

set local lock_timeout = '5s';

-- ---- file names ----------------------------------------------------------------------------------------------------
alter table public.vendor_links add column if not exists orig_label text, add column if not exists name_auto boolean not null default false;
comment on column public.vendor_links.orig_label is 'The name the file came with (the vendor''s name for it), before VMS named it (Dana, Oct 28).';
comment on column public.vendor_links.name_auto is 'The name is VMS''s standard name and follows the kind, number and date; false once someone renames the file.';

create or replace function public.vendor_link_std_name(p_kind text, p_number text, p_date date, p_orig text)
returns text language plpgsql immutable set search_path = public as $$
declare
  word text := case p_kind when 'confirmation' then 'Confirmation' when 'invoice' then 'Invoice' when 'credit' then 'Credit'
                 when 'order' then 'Our order' when 'packing_slip' then 'Packing slip' when 'delivery_receipt' then 'Delivery receipt'
                 when 'freight_bill' then 'Freight bill' when 'payment' then 'Payment' end;
  head text;
  o    text;
  n_o  text;
begin
  if word is null then return null; end if;
  head := word || coalesce(' ' || nullif(trim(p_number), ''), '');
  -- the vendor's name for it, without the file type and without repeating the word in front
  o := trim(regexp_replace(coalesce(p_orig, ''), '\.[A-Za-z0-9]{2,5}$', ''));
  o := trim(regexp_replace(o, '^' || word || '[\s_:#–-]*', '', 'i'));
  n_o := lower(regexp_replace(o, '[^A-Za-z0-9]', '', 'g'));
  return left(head
    || case when n_o = '' or position(n_o in lower(regexp_replace(head, '[^A-Za-z0-9]', '', 'g'))) > 0 then '' else ' – ' || o end
    || coalesce(' – ' || to_char(p_date, 'Mon FMDD, YYYY'), ''), 200);
end;
$$;
grant execute on function public.vendor_link_std_name(text, text, date, text) to authenticated, service_role;

create or replace function public.vendor_links_name() returns trigger
language plpgsql set search_path = public as $$
declare v text;
begin
  if tg_op = 'INSERT' then
    new.orig_label := coalesce(nullif(new.orig_label, ''), new.label);
  else
    new.orig_label := coalesce(new.orig_label, old.orig_label, old.label);
    -- renamed by hand: keep it
    if new.label is distinct from old.label then new.name_auto := false; return new; end if;
    if not (old.name_auto or old.label = new.orig_label) then return new; end if;
    if old.name_auto and (new.kind, new.doc_number, new.doc_date, new.received_at) is not distinct from (old.kind, old.doc_number, old.doc_date, old.received_at) then return new; end if;
  end if;
  v := public.vendor_link_std_name(new.kind, new.doc_number, coalesce(new.doc_date, new.received_at, (new.created_at at time zone 'America/Los_Angeles')::date), new.orig_label);
  if v is not null then
    new.label := v; new.name_auto := true;
  elsif new.name_auto then
    -- moved out of the paperwork folders: back to the name it came with
    new.label := new.orig_label; new.name_auto := false;
  end if;
  return new;
end;
$$;

-- back-check first (the trigger is not on yet): every paperwork file already filed
update public.vendor_links set orig_label = label where orig_label is null;
update public.vendor_links l set label = x.n, name_auto = true
  from (select id, public.vendor_link_std_name(kind, doc_number, coalesce(doc_date, received_at, (created_at at time zone 'America/Los_Angeles')::date), orig_label) n from public.vendor_links) x
 where x.id = l.id and x.n is not null;

-- runs after the other before-triggers (alphabetical), so it sees the final kind and number
drop trigger if exists vendor_links_z_name on public.vendor_links;
create trigger vendor_links_z_name before insert or update on public.vendor_links for each row execute function public.vendor_links_name();

-- ---- files kept with a draft -----------------------------------------------------------------------------------------
alter table public.email_drafts add column if not exists vendor_link_ids uuid[] not null default '{}';
comment on column public.email_drafts.vendor_link_ids is 'Vendor files that go with this email when it sends (Dana, Oct 28).';

-- ---- reply all on VMS drafts ---------------------------------------------------------------------------------------------
-- Everyone on the vendor's email a draft answers that the draft doesn't already have, minus our own addresses and robots.
create or replace function public.draft_everyone_cc(p_org uuid, p_thread uuid, p_reply_to uuid, p_to text[], p_cc text[])
returns text[] language plpgsql stable security definer set search_path = public as $$
declare
  src  public.emails%rowtype;
  have text[] := array(select lower(trim(x)) from unnest(coalesce(p_to, '{}') || coalesce(p_cc, '{}')) x);
  a    text;
  out  text[] := coalesce(p_cc, '{}');
begin
  if p_thread is null then return out; end if;
  -- the email it answers: the one named, else their latest email in the conversation that has one of the To people on it
  select * into src from public.emails where id = p_reply_to and direction = 'in';
  if src.id is null then
    select * into src from public.emails e
     where e.thread_id = p_thread and e.direction = 'in'
       and exists (select 1 from unnest(array[e.from_email] || coalesce(e.to_emails, '{}') || coalesce(e.cc_emails, '{}')) x where lower(trim(x)) = any (have))
     order by e.received_at desc limit 1;
  end if;
  if src.id is null then return out; end if;
  -- only when the draft goes to someone on that email (not a note to one of us)
  if not exists (select 1 from unnest(array[src.from_email] || coalesce(src.to_emails, '{}') || coalesce(src.cc_emails, '{}')) x
                  where lower(trim(x)) = any (array(select lower(trim(y)) from unnest(coalesce(p_to, '{}')) y))) then return out; end if;
  for a in select distinct lower(trim(x)) from unnest(array[src.from_email] || coalesce(src.to_emails, '{}') || coalesce(src.cc_emails, '{}')) x loop
    if a is null or a = '' or a = any (have) or a !~ '@' or a ~ '(no-?reply|do-?not-?reply|mailer-daemon|postmaster)' or public.is_our_address(p_org, a) then continue; end if;
    out := out || a; have := have || a;
  end loop;
  return out;
end;
$$;
revoke execute on function public.draft_everyone_cc(uuid, uuid, uuid, text[], text[]) from public, anon, authenticated;

-- VMS's drafts (made by VMS, or carrying VMS's note); a person's own Reply / Reply all in the app is left as they chose.
create or replace function public.email_drafts_reply_all() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.thread_id is null or new.forward_email_id is not null then return new; end if;
  if not (new.created_by is null or new.note is not null or auth.uid() is null) then return new; end if;
  new.cc_emails := public.draft_everyone_cc(new.organization_id, new.thread_id, new.reply_to_email_id, new.to_emails, new.cc_emails);
  return new;
end;
$$;
drop trigger if exists email_drafts_reply_all on public.email_drafts;
create trigger email_drafts_reply_all before insert on public.email_drafts for each row execute function public.email_drafts_reply_all();

-- back-check: the VMS drafts waiting now (not Dana's draft to Maria)
update public.email_drafts d set cc_emails = public.draft_everyone_cc(d.organization_id, d.thread_id, d.reply_to_email_id, d.to_emails, d.cc_emails)
 where d.thread_id is not null and d.forward_email_id is null and (d.created_by is null or d.note is not null)
   and d.id <> 'd3771b34-68e3-4b36-9138-62bf1654d4dd';

-- ---- a credit follow-up carries the files our first request had ------------------------------------------------------
create or replace function public.credit_request_followup(p_task uuid)
 returns uuid
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare t public.tasks%rowtype; r public.credit_requests%rowtype; m public.emails%rowtype; v_draft uuid; v_vn text; v_first text; v_last uuid;
begin
  select * into t from public.tasks where id = p_task and done_at is null and auto_key like 'credit_req:%';
  if t.id is null or t.draft_id is not null then return t.draft_id; end if;
  select * into r from public.credit_requests where id = substr(t.auto_key, 12)::uuid;
  if r.id is null or r.status <> 'open' then return null; end if;
  select * into m from public.emails where id = r.email_id;
  select name into v_vn from public.vendors where id = r.vendor_id;
  select split_part(full_name, ' ', 1) into v_first from public.profiles where id = t.assigned_to;
  select id into v_last from public.emails where thread_id = r.thread_id and direction <> 'internal' order by received_at desc limit 1;
  insert into public.email_drafts (organization_id, owner_id, created_by, to_emails, cc_emails, subject, body, thread_id, reply_to_email_id, vendor_id, note, vendor_link_ids)
    values (r.organization_id, t.assigned_to, t.assigned_to, m.to_emails, coalesce(m.cc_emails, '{}'),
            case when m.subject ilike 'Re:%' then m.subject else 'Re: ' || coalesce(m.subject, 'Credit request') end,
            'Hi,' || E'\n\n' || 'Following up on the credit we asked for on ' || to_char(m.received_at at time zone 'America/Los_Angeles', 'Mon FMDD')
            || case when r.invoice_number is not null then ' for invoice ' || r.invoice_number else '' end
            || case when r.amount is not null then ' ($' || to_char(r.amount, 'FM999,999,990.00') || ')' else '' end
            || ' (' || r.what || E'). We have not seen the credit memo yet. Could you send it over, or let us know when it will be issued?\n\nThanks,\n' || coalesce(v_first, ''),
            r.thread_id, coalesce(v_last, r.email_id), r.vendor_id,
            'Follow-up on the credit from ' || coalesce(v_vn, 'the vendor') || ' (VMS made this draft with the 7-day reminder; send it or change it)',
            array(select l.id from public.vendor_links l where l.email_id = r.email_id and l.storage_path is not null order by l.created_at))
    returning id into v_draft;
  update public.tasks set draft_id = v_draft where id = p_task;
  return v_draft;
end $function$;
