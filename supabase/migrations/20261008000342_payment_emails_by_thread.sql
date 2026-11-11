-- 0342 — A payment email that names no invoice numbers (Dana, Nov 11: "yes go, build it and re-check them"). Dana's Sep 28
-- email "I paid them over the phone by credit card on 9/23/26" named no numbers, so VMS marked nothing although both
-- invoices had come in earlier in the same conversation.
--   • No numbers and nothing attached: VMS marks the vendor's unpaid invoices that came in earlier in the same conversation.
--   • An invoice from that conversation filed later is marked when it is filed.
--   • Still nothing, but the vendor has unpaid invoices from the 120 days before the email: a task for the admin asks
--     which ones it paid (tick them and press Mark paid, or None of these). It closes when she answers, or by itself once
--     none of those invoices is unpaid any more. Only for payment emails from the last 120 days.
--   • Back-check below: every payment email read so far that marked nothing.
set local lock_timeout = '5s';

/** Unpaid invoices of the notice's vendor that came in the same conversation, at or before the payment email. */
create or replace function public.payment_notice_thread_invoices(p_email uuid) returns setof uuid
language sql stable security definer set search_path = public as $$
  select distinct l.id
    from public.payment_notices n
    join public.emails pe on pe.id = n.email_id
    join public.emails e on e.thread_id = pe.thread_id and e.received_at <= pe.received_at
    join public.vendor_links l on l.vendor_id = n.vendor_id and l.kind = 'invoice' and l.paid_at is null
     and (l.email_id = e.id or l.id in (select a.vendor_link_id from public.email_attachments a where a.email_id = e.id and a.vendor_link_id is not null))
   where n.email_id = p_email
$$;
revoke execute on function public.payment_notice_thread_invoices(uuid) from public, anon, authenticated;

/** The invoices a payment email could have paid: the vendor's unpaid ones from the 120 days before it. */
create or replace function public.payment_notice_open_invoices(p_email uuid)
returns table (id uuid, label text, doc_number text, doc_date date, doc_total numeric, received_at date, storage_path text, file_name text, mime_type text)
language sql stable security definer set search_path = public as $$
  select l.id, l.label, l.doc_number, l.doc_date, l.doc_total, l.received_at, l.storage_path, l.file_name, l.mime_type
    from public.payment_notices n
    join public.emails pe on pe.id = n.email_id
    join public.vendor_links l on l.vendor_id = n.vendor_id and l.kind = 'invoice' and l.paid_at is null
   where n.email_id = p_email
     and coalesce(l.doc_date, l.received_at, l.created_at::date) between pe.received_at::date - 120 and pe.received_at::date
   order by coalesce(l.doc_date, l.received_at, l.created_at::date) desc
$$;
revoke execute on function public.payment_notice_open_invoices(uuid) from public, anon, authenticated;

/** The same, for the question's screen: only people who see Accounting. */
create or replace function public.payment_notice_choices(p_email uuid)
returns table (id uuid, label text, doc_number text, doc_date date, doc_total numeric, received_at date, storage_path text, file_name text, mime_type text)
language sql stable security definer set search_path = public as $$
  select c.* from public.payment_notice_open_invoices(p_email) c
   where exists (select 1 from public.payment_notices n where n.email_id = p_email and public.user_in_org(n.organization_id))
     and public.sees_accounting()
$$;
revoke execute on function public.payment_notice_choices(uuid) from public, anon;
grant execute on function public.payment_notice_choices(uuid) to authenticated;

/** No invoice to mark: ask the admin which ones it paid, when there are any it could be and the email is recent. */
create or replace function public.payment_notice_ask(p_email uuid) returns boolean
language plpgsql security definer set search_path = public as $$
declare n record; who uuid; k integer;
begin
  select p.*, v.name as vname, e.thread_id, e.received_at as sent_at into n
    from public.payment_notices p join public.vendors v on v.id = p.vendor_id join public.emails e on e.id = p.email_id
   where p.email_id = p_email;
  if n.email_id is null or not coalesce(n.is_payment, false) or n.marked > 0 or n.sent_at < now() - interval '120 days' then return false; end if;
  select count(*) into k from public.payment_notice_open_invoices(p_email);
  who := public.org_admin(n.organization_id);
  if k = 0 or who is null then return false; end if;
  insert into public.tasks (organization_id, title, notes, due_date, remind_at, assigned_to, vendor_id, thread_id, auto_key, area)
  values (n.organization_id,
          format('Which %s invoices did the %s payment pay?', n.vname, to_char(coalesce(n.paid_on, n.sent_at::date), 'FMMM/FMDD/YY')),
          concat_ws(' ', 'VMS read a payment email that names no invoice numbers:', coalesce(n.note, '') ,
                    format('%s has %s unpaid invoice%s from the 120 days before it.', n.vname, k, case when k = 1 then '' else 's' end),
                    'Tick the ones it paid and press Mark paid, or press None of these.'),
          current_date, now(), who, n.vendor_id, n.thread_id, 'payask:' || n.email_id, 'accounting')
  on conflict (organization_id, auto_key) where auto_key is not null do nothing;
  return found;
end;
$$;
revoke execute on function public.payment_notice_ask(uuid) from public, anon, authenticated;

/** No numbers, nothing attached: the unpaid invoices from the same conversation; else ask. Returns how many were marked. */
create or replace function public.payment_notice_by_thread(p_email uuid) returns integer
language plpgsql security definer set search_path = public as $$
declare n public.payment_notices%rowtype; x uuid; k integer := 0;
begin
  select * into n from public.payment_notices where email_id = p_email;
  if n.email_id is null or not coalesce(n.is_payment, false) or n.marked > 0 or n.attached or n.numbers <> '{}' then return 0; end if;
  for x in select * from public.payment_notice_thread_invoices(p_email) loop
    if public.invoice_mark_paid(x, n) then k := k + 1; end if;
  end loop;
  if k > 0 then
    update public.payment_notices set marked = k where email_id = p_email;
    insert into public.activity_log (organization_id, entity_type, entity_id, action, details, actor_id)
    values (n.organization_id, 'vendor', n.vendor_id, 'invoices_paid',
            jsonb_build_object('email_id', n.email_id, 'count', k, 'how', n.how, 'paid_on', n.paid_on,
                               'note', format('%s invoice%s from the same conversation marked paid%s', k, case when k = 1 then '' else 's' end, coalesce(' (' || n.how || ')', ''))), null);
  else
    perform public.payment_notice_ask(p_email);
  end if;
  return k;
end;
$$;
revoke execute on function public.payment_notice_by_thread(uuid) from public, anon, authenticated;

create or replace function public.payment_notice_read(p_email uuid, p_is_payment boolean, p_paid_on date, p_how text, p_numbers text[], p_attached boolean, p_note text)
returns integer
language plpgsql security definer set search_path = public as $$
declare n public.payment_notices%rowtype; l record; v_marked integer := 0; v_found text[] := '{}';
begin
  update public.payment_notices set read_at = now(), is_payment = p_is_payment, paid_on = p_paid_on, how = left(nullif(trim(p_how), ''), 120),
         numbers = coalesce((select array_agg(distinct trim(x)) from unnest(p_numbers) x where public.po_norm(x) <> ''), '{}'),
         attached = coalesce(p_attached, false), note = left(p_note, 300)
   where email_id = p_email returning * into n;
  if n.email_id is null or not coalesce(p_is_payment, false) then return 0; end if;
  for l in
    select x.id, x.doc_number from public.vendor_links x
     where x.vendor_id = n.vendor_id and x.kind = 'invoice'
       and ((x.doc_number is not null and public.po_norm(x.doc_number) = any (select public.po_norm(y) from unnest(n.numbers) y))
            or (n.attached and x.id in (select a.vendor_link_id from public.email_attachments a where a.email_id = n.email_id and a.vendor_link_id is not null)))
  loop
    if public.invoice_mark_paid(l.id, n) then v_marked := v_marked + 1; end if;
    if l.doc_number is not null then v_found := v_found || public.po_norm(l.doc_number); end if;
  end loop;
  update public.payment_notices set marked = v_marked,
         unmatched = coalesce((select array_agg(y) from unnest(numbers) y where not (public.po_norm(y) = any (v_found))), '{}')
   where email_id = p_email;
  if v_marked > 0 then
    insert into public.activity_log (organization_id, entity_type, entity_id, action, details, actor_id)
    values (n.organization_id, 'vendor', n.vendor_id, 'invoices_paid',
            jsonb_build_object('email_id', n.email_id, 'count', v_marked, 'how', n.how, 'paid_on', n.paid_on,
                               'note', format('%s invoice%s marked paid%s', v_marked, case when v_marked = 1 then '' else 's' end, coalesce(' (' || n.how || ')', ''))), null);
  elsif n.numbers = '{}' and not n.attached then
    -- no numbers, nothing attached (Dana, Nov 11): the conversation's invoices, else ask
    v_marked := public.payment_notice_by_thread(p_email);
  end if;
  return v_marked;
end;
$$;
revoke execute on function public.payment_notice_read(uuid, boolean, date, text, text[], boolean, text) from public, anon, authenticated;
grant execute on function public.payment_notice_read(uuid, boolean, date, text, text[], boolean, text) to service_role;

-- an invoice filed after its payment email: its number was named, it came attached to that email, or (no numbers named)
-- it came earlier in the same conversation
create or replace function public.vendor_links_paid_later() returns trigger
language plpgsql security definer set search_path = public as $$
declare n public.payment_notices%rowtype;
begin
  if new.kind <> 'invoice' or new.paid_at is not null then return null; end if;
  select p.* into n from public.payment_notices p
   where p.vendor_id = new.vendor_id and p.is_payment
     and ((new.doc_number is not null and public.po_norm(new.doc_number) = any (select public.po_norm(y) from unnest(p.unmatched) y))
          or (p.attached and p.email_id = new.email_id)
          or (p.numbers = '{}' and not p.attached and p.marked = 0 and new.email_id is not null
              and exists (select 1 from public.emails pe join public.emails ie on ie.thread_id = pe.thread_id
                           where pe.id = p.email_id and ie.id = new.email_id and ie.received_at <= pe.received_at)))
   order by p.read_at desc limit 1;
  if n.email_id is not null then
    perform public.invoice_mark_paid(new.id, n);
    update public.payment_notices set marked = marked + 1,
           unmatched = array(select y from unnest(unmatched) y where public.po_norm(y) <> public.po_norm(coalesce(new.doc_number, '')))
     where email_id = n.email_id;
  end if;
  return null;
end;
$$;
revoke execute on function public.vendor_links_paid_later() from public, anon, authenticated;

/** Mark paid (Dana's answer): the invoices she ticked; none = "None of these". Closes the question. */
create or replace function public.payment_notice_pick(p_email uuid, p_links uuid[]) returns integer
language plpgsql security definer set search_path = public as $$
declare n public.payment_notices%rowtype; x uuid; k integer := 0;
begin
  select * into n from public.payment_notices where email_id = p_email;
  if n.email_id is null or not public.user_in_org(n.organization_id) or not public.sees_accounting() then
    raise exception 'Only people who see Accounting can mark invoices paid' using errcode = '42501';
  end if;
  foreach x in array coalesce(p_links, '{}') loop
    if x in (select c.id from public.payment_notice_open_invoices(p_email) c) and public.invoice_mark_paid(x, n) then k := k + 1; end if;
  end loop;
  update public.payment_notices set marked = marked + k where email_id = p_email;
  update public.tasks set done_at = now(), done_by = auth.uid(),
         done_note = case when k = 0 then 'None of these: the payment was for invoices not on file.'
                          else format('Marked %s invoice%s paid.', k, case when k = 1 then '' else 's' end) end
   where organization_id = n.organization_id and auto_key = 'payask:' || p_email and done_at is null;
  if k > 0 then
    insert into public.activity_log (organization_id, entity_type, entity_id, action, details, actor_id)
    values (n.organization_id, 'vendor', n.vendor_id, 'invoices_paid',
            jsonb_build_object('email_id', n.email_id, 'count', k, 'how', n.how, 'paid_on', n.paid_on,
                               'note', format('%s invoice%s marked paid', k, case when k = 1 then '' else 's' end)), auth.uid());
  end if;
  return k;
end;
$$;
revoke execute on function public.payment_notice_pick(uuid, uuid[]) from public, anon;
grant execute on function public.payment_notice_pick(uuid, uuid[]) to authenticated;

-- done means closed (Dana, Nov 7): once none of the invoices it could be is unpaid, the question closes itself
create or replace function public.vendor_links_payask_done() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.kind <> 'invoice' or new.paid_at is null or old.paid_at is not null then return null; end if;
  update public.tasks t set done_at = now(), done_note = 'Every invoice this payment could have paid is marked paid now.'
   where t.organization_id = new.organization_id and t.vendor_id = new.vendor_id and t.auto_key like 'payask:%' and t.done_at is null
     and not exists (select 1 from public.payment_notice_open_invoices(substr(t.auto_key, 8)::uuid));
  return null;
end;
$$;
revoke execute on function public.vendor_links_payask_done() from public, anon, authenticated;
drop trigger if exists vendor_links_payask_done on public.vendor_links;
create trigger vendor_links_payask_done after update of paid_at on public.vendor_links for each row execute function public.vendor_links_payask_done();

-- ---- back-check: every payment email read so far that marked nothing --------------------------------------------
do $$ declare p record; begin
  for p in select email_id from public.payment_notices where is_payment and marked = 0 and numbers = '{}' and not attached loop
    perform public.payment_notice_by_thread(p.email_id);
  end loop;
end $$;
