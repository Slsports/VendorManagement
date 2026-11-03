-- 0293 — WWD's Payments Due list (Dana, Nov 3: "I also have a Future Pmts due ss from WWD. Please add reminders for me 3 days
--   in advance. Also, there is a column for 'discount' & date, if you pay by the discount date you get the discount. If you
--   don't you cannot take the discount. I always like to take advantage of that.").
--   Their labels → VMS: Invoice # → WWD invoice number; Date Inv → WWD date; Date Due → wwd_due_date (and due_date: WWD's own
--   screen is the newest word); Disc Date → disc_date; Disc Avail → disc_avail; Vendor → WWD vendor name; Inv Amt → amount.
--   Nothing on the list is paid: it never sets a paid date (the reader now tells it apart from a payment sheet).
--   Reminders: pay by the Disc Date to take the discount, else by the Date Due; 3 days before.
set local lock_timeout = '5s';

alter table public.wwd_invoices add column if not exists wwd_due_date date;
alter table public.wwd_invoices add column if not exists disc_date date;
alter table public.wwd_invoices add column if not exists disc_avail numeric(12,2);
alter table public.wwd_invoices add column if not exists due_list_at timestamptz;
comment on column public.wwd_invoices.wwd_due_date is 'Date Due on WWD''s Payments Due list.';
comment on column public.wwd_invoices.disc_date is 'Disc Date on WWD''s Payments Due list: pay by then to take the discount.';
comment on column public.wwd_invoices.disc_avail is 'Disc Avail on WWD''s Payments Due list: the discount taken when paid by disc_date.';

-- p: {rows: [{seq, kind, wwd_date, vendor_name, amount, amount_due, due_date, disc_date, disc_avail}]}
create or replace function public.wwd_due_list(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_org  uuid := public.current_user_org();
  r      jsonb;
  v_id   uuid;
  v_old  date;
  v_kind text;
  n_rows integer := 0; n_new integer := 0; n_dates integer := 0; n_disc integer := 0; n_tasks integer;
begin
  if not public.user_can_edit() then raise exception 'Only admins, managers and buyers import WWD payments' using errcode = '42501'; end if;
  for r in select * from jsonb_array_elements(coalesce(p->'rows', '[]'::jsonb)) loop
    if nullif(trim(r->>'seq'), '') is null then continue; end if;
    v_kind := coalesce(nullif(r->>'kind', ''), 'invoice');
    n_rows := n_rows + 1;
    select id, coalesce(wwd_due_date, due_date) into v_id, v_old from public.wwd_invoices
     where organization_id = v_org and seq = trim(r->>'seq') and kind = v_kind;
    if v_id is null then
      insert into public.wwd_invoices (organization_id, seq, kind, wwd_date, wwd_vendor_name, amount, due_date, sources)
      values (v_org, trim(r->>'seq'), v_kind, nullif(r->>'wwd_date', '')::date, nullif(r->>'vendor_name', ''), nullif(r->>'amount', '')::numeric,
              nullif(r->>'due_date', '')::date, array['due_list'])
      returning id into v_id;
      n_new := n_new + 1;
    elsif v_old is distinct from nullif(r->>'due_date', '')::date then
      n_dates := n_dates + 1;
    end if;
    update public.wwd_invoices set
           wwd_due_date = coalesce(nullif(r->>'due_date', '')::date, wwd_due_date),
           due_date = coalesce(nullif(r->>'due_date', '')::date, due_date),
           disc_date = nullif(r->>'disc_date', '')::date,
           disc_avail = nullif(r->>'disc_avail', '')::numeric,
           wwd_date = coalesce(wwd_date, nullif(r->>'wwd_date', '')::date),
           wwd_vendor_name = coalesce(wwd_vendor_name, nullif(r->>'vendor_name', '')),
           amount = coalesce(amount, nullif(r->>'amount', '')::numeric),
           sources = case when 'due_list' = any(sources) then sources else array_append(sources, 'due_list') end,
           due_list_at = now(), updated_at = now()
     where id = v_id;
    if nullif(r->>'disc_avail', '')::numeric > 0 then n_disc := n_disc + 1; end if;
  end loop;
  perform public.wwd_relink(v_org);
  n_tasks := public.sync_payment_tasks(v_org);
  return jsonb_build_object('rows', n_rows, 'added', n_new, 'dates_changed', n_dates, 'with_discount', n_disc,
    'reminders', (select count(*) from public.tasks t join public.wwd_invoices w on t.auto_key like 'wwd:' || w.id || ':%'
                   where w.organization_id = v_org and w.due_list_at > now() - interval '1 minute' and t.done_at is null));
end;
$$;
revoke execute on function public.wwd_due_list(jsonb) from public, anon;
grant execute on function public.wwd_due_list(jsonb) to authenticated, service_role;

-- reminders: WWD's Payments Due list first (3 days before), the terms tiers for the rest (5 days before)
create or replace function public.sync_payment_tasks(p_org uuid default null)
returns integer
language plpgsql security definer set search_path = public as $function$
declare
  c record;
  t public.tasks%rowtype;
  n integer := 0;
  remind timestamptz;
begin
  create temp table if not exists pay_candidates (
    organization_id uuid, auto_key text, bill_key text, vendor_id uuid, order_id uuid, tag_other text, title text, notes text, due_date date,
    remind_days integer not null default 5
  ) on commit drop;
  truncate pay_candidates;

  -- WWD's Payments Due list (Dana, Nov 3): WWD's own dates win. Pay by the Disc Date to take the discount ("I always like
  -- to take advantage of that"); once it passes, by the Date Due. Reminded 3 days before.
  insert into pay_candidates
  select w.organization_id, 'wwd:' || w.id || ':' || case when disc then 'disc' else 'due' end, 'wwd:' || w.id, w.vendor_id, w.order_id,
         'WWD invoice ' || w.seq,
         case when disc
           then format('Pay %s by %s to take the $%s discount (WWD %s)', coalesce(v.name, w.wwd_vendor_name, 'WWD'), to_char(w.disc_date, 'Mon FMDD, YYYY'),
                       to_char(w.disc_avail, 'FM999,990.00'), w.seq)
           else format('Pay %s by %s ($%s, WWD %s)', coalesce(v.name, w.wwd_vendor_name, 'WWD'), to_char(w.wwd_due_date, 'Mon FMDD, YYYY'),
                       to_char(w.amount, 'FM999,990.00'), w.seq)
         end,
         case when disc
           then format('WWD invoice %s for $%s. Paid by %s you take $%s off (WWD''s Payments Due list: Disc Date and Disc Avail); after that the full amount is due %s.',
                       w.seq, to_char(w.amount, 'FM999,990.00'), to_char(w.disc_date, 'Mon FMDD, YYYY'), to_char(w.disc_avail, 'FM999,990.00'), to_char(w.wwd_due_date, 'Mon FMDD, YYYY'))
           else format('WWD invoice %s for $%s, due %s (WWD''s Payments Due list).', w.seq, to_char(w.amount, 'FM999,990.00'), to_char(w.wwd_due_date, 'Mon FMDD, YYYY'))
         end,
         case when disc then w.disc_date else w.wwd_due_date end,
         3
  from public.wwd_invoices w
  left join public.vendors v on v.id = w.vendor_id
  cross join lateral (select (w.disc_date is not null and coalesce(w.disc_avail, 0) > 0 and w.disc_date >= current_date) as disc) x
  where (p_org is null or w.organization_id = p_org)
    and w.due_list_at is not null and w.wwd_due_date is not null
    and w.kind = 'invoice' and w.paid_date is null and w.sheet_paid_date is null and coalesce(w.amount, 0) > 0
    and (x.disc or w.wwd_due_date >= current_date);

  -- WWD invoices with discount terms: the first tier whose date has not passed, else the net due date
  insert into pay_candidates
  select w.organization_id, 'wwd:' || w.id || ':' || coalesce(tier.days::text, 'net'), 'wwd:' || w.id, w.vendor_id, w.order_id,
         'WWD invoice ' || w.seq,
         case when tier.days is not null
           then format('Pay %s by %s for %s%% off ($%s)', coalesce(v.name, w.wwd_vendor_name, 'WWD'), to_char(base + tier.days, 'Mon FMDD, YYYY'),
                       trim(to_char(tier.pct, 'FM990.##')), to_char(round(w.amount * tier.pct / 100, 2), 'FM999,990.00'))
           else format('Pay %s by %s (payment due, $%s)', coalesce(v.name, w.wwd_vendor_name, 'WWD'), to_char(net, 'Mon FMDD, YYYY'), to_char(w.amount, 'FM999,990.00'))
         end,
         format('WWD invoice %s%s for $%s, terms %s.', w.seq, case when w.vendor_invoice_number is not null then ' (vendor invoice ' || w.vendor_invoice_number || ')' else '' end,
                to_char(w.amount, 'FM999,990.00'), w.terms),
         coalesce(base + tier.days, net)
  from public.wwd_invoices w
  left join public.vendors v on v.id = w.vendor_id
  cross join lateral (select coalesce(w.vendor_invoice_date, w.wwd_date) as base) b
  cross join lateral (select coalesce(w.due_date, b.base + public.pay_terms_net(w.terms)) as net) d
  left join lateral (
    select x.pct, x.days from public.pay_terms_tiers(w.terms) x where b.base + x.days >= current_date order by x.days limit 1
  ) tier on true
  where (p_org is null or w.organization_id = p_org)
    and w.kind = 'invoice' and w.paid_date is null and w.sheet_paid_date is null and coalesce(w.amount, 0) > 0
    and exists (select 1 from public.pay_terms_tiers(w.terms))
    and w.due_list_at is null
    and b.base is not null
    and coalesce(b.base + tier.days, d.net) >= current_date;

  -- orders whose AR due notes carry a discount, unpaid, not covered by a WWD invoice
  insert into pay_candidates
  select o.organization_id, 'order:' || o.id || ':terms', 'order:' || o.id || ':terms', o.vendor_id, o.id, null,
         format('Pay %s by %s (%s)', v.name, to_char(o.ar_due_date, 'Mon FMDD, YYYY'), o.ar_due),
         'From the order''s AR due: ' || o.ar_due,
         o.ar_due_date
  from public.orders o join public.vendors v on v.id = o.vendor_id
  where (p_org is null or o.organization_id = p_org)
    and o.ar_due ~ '%' and o.ar_due_date >= current_date
    and o.paid_date is null and o.status not in ('paid', 'cancelled')
    and not exists (select 1 from public.wwd_invoices w where w.order_id = o.id);

  -- freight back for paying on time
  insert into pay_candidates
  select o.organization_id, 'order:' || o.id || ':freight', 'order:' || o.id || ':freight', o.vendor_id, o.id, null,
         format('Pay %s by %s to get the freight back%s', v.name, to_char(o.freight_allowance_pay_by, 'Mon FMDD, YYYY'),
                case when o.freight_allowance is not null then ' ($' || to_char(o.freight_allowance, 'FM999,990.00') || ')' else '' end),
         'This vendor credits the freight back when the invoice is paid on time.',
         o.freight_allowance_pay_by
  from public.orders o join public.vendors v on v.id = o.vendor_id
  where (p_org is null or o.organization_id = p_org)
    and o.freight_allowance_offered and o.freight_allowance_received is null and o.freight_allowance_pay_by >= current_date
    and o.paid_date is null and o.status not in ('paid', 'cancelled');

  -- a bill someone already checked off by hand is handled
  delete from pay_candidates pc where exists (
    select 1 from public.tasks x where x.organization_id = pc.organization_id and x.auto_key like pc.bill_key || '%' and x.done_at is not null and x.done_by is not null);

  for c in select * from pay_candidates loop
    remind := ((c.due_date - c.remind_days) + time '08:00') at time zone 'America/Los_Angeles';
    if remind < now() then remind := now(); end if;
    select * into t from public.tasks where organization_id = c.organization_id and auto_key = c.auto_key;
    if t.id is null then
      insert into public.tasks (organization_id, title, notes, due_date, remind_at, assigned_to, vendor_id, order_id, tag_other, auto_key)
      select c.organization_id, c.title, c.notes, c.due_date, remind, a, c.vendor_id, c.order_id, c.tag_other, c.auto_key
      from public.org_admin(c.organization_id) a where a is not null;
      n := n + 1;
    elsif t.done_at is null and (t.title <> c.title or t.due_date is distinct from c.due_date) then
      update public.tasks set title = c.title, notes = c.notes, due_date = c.due_date,
        remind_at = case when t.due_date is distinct from c.due_date then remind else remind_at end
      where id = t.id;
    end if;
  end loop;

  -- open automatic tasks no longer wanted: paid, or their date passed and a later one took over
  update public.tasks x set done_at = now(), done_notified_at = now(), done_seen_at = now(),
    done_note = case
      when x.auto_key like 'wwd:%' and exists (select 1 from public.wwd_invoices w where 'wwd:' || w.id = split_part(x.auto_key, ':', 1) || ':' || split_part(x.auto_key, ':', 2) and (w.paid_date is not null or w.sheet_paid_date is not null)) then 'Paid'
      when x.auto_key like 'order:%' and exists (select 1 from public.orders o where 'order:' || o.id = split_part(x.auto_key, ':', 1) || ':' || split_part(x.auto_key, ':', 2) and (o.paid_date is not null or o.status = 'paid' or o.freight_allowance_received is not null)) then 'Paid'
      when x.auto_key like 'wwd:%' and exists (select 1 from pay_candidates pc where pc.organization_id = x.organization_id
             and pc.bill_key = split_part(x.auto_key, ':', 1) || ':' || split_part(x.auto_key, ':', 2) and pc.auto_key like '%:due')
           and x.auto_key like '%:disc' then 'Closed by VMS: the discount date passed; the reminder to pay by the due date took over.'
      when x.auto_key like 'wwd:%' and exists (select 1 from pay_candidates pc where pc.organization_id = x.organization_id
             and pc.bill_key = split_part(x.auto_key, ':', 1) || ':' || split_part(x.auto_key, ':', 2))
        then 'Closed by VMS: replaced by the reminder from WWD''s Payments Due list (WWD''s own dates).'
      else 'The date passed'
    end
  where x.auto_key is not null and (x.auto_key like 'wwd:%' or x.auto_key like 'order:%') and x.done_at is null and (p_org is null or x.organization_id = p_org)
    and not exists (select 1 from pay_candidates pc where pc.organization_id = x.organization_id and pc.auto_key = x.auto_key);

  return n;
end;
$function$;
revoke execute on function public.sync_payment_tasks(uuid) from public, anon;
grant execute on function public.sync_payment_tasks(uuid) to authenticated, service_role;

select public.sync_payment_tasks();
