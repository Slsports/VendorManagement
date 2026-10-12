-- 0091 — Pay-by reminders: a bill on Dana's WWD payment sheet is paid (Oct 12: she posted the 10-8-26 sheet and the
-- Fishoholic and Panther Martin reminders should go). WWD counts a bill paid by its Payment History, EdenRed or a
-- payment sheet; the reminders now do too.
create or replace function public.sync_payment_tasks(p_org uuid default null)
returns integer
language plpgsql security definer set search_path = public as $$
declare
  c record;
  t public.tasks%rowtype;
  n integer := 0;
  remind timestamptz;
begin
  create temp table if not exists pay_candidates (
    organization_id uuid, auto_key text, bill_key text, vendor_id uuid, order_id uuid, tag_other text, title text, notes text, due_date date
  ) on commit drop;
  truncate pay_candidates;

  -- WWD invoices with discount terms: the first tier whose date has not passed, else the net due date
  insert into pay_candidates
  select w.organization_id, 'wwd:' || w.id || ':' || coalesce(tier.days::text, 'net'), 'wwd:' || w.id, w.vendor_id, w.order_id,
         'WWD invoice ' || w.seq,
         case when tier.days is not null
           then format('Pay %s by %s for %s%% off ($%s)', coalesce(v.name, w.wwd_vendor_name, 'WWD'), to_char(base + tier.days, 'Mon FMDD'),
                       trim(to_char(tier.pct, 'FM990.##')), to_char(round(w.amount * tier.pct / 100, 2), 'FM999,990.00'))
           else format('Pay %s by %s (payment due, $%s)', coalesce(v.name, w.wwd_vendor_name, 'WWD'), to_char(net, 'Mon FMDD'), to_char(w.amount, 'FM999,990.00'))
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
    and b.base is not null
    and coalesce(b.base + tier.days, d.net) >= current_date;

  -- orders whose AR due notes carry a discount, unpaid, not covered by a WWD invoice
  insert into pay_candidates
  select o.organization_id, 'order:' || o.id || ':terms', 'order:' || o.id || ':terms', o.vendor_id, o.id, null,
         format('Pay %s by %s (%s)', v.name, to_char(o.ar_due_date, 'Mon FMDD'), o.ar_due),
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
         format('Pay %s by %s to get the freight back%s', v.name, to_char(o.freight_allowance_pay_by, 'Mon FMDD'),
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
    remind := ((c.due_date - 5) + time '08:00') at time zone 'America/Los_Angeles';
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
      else 'The date passed'
    end
  where x.auto_key is not null and x.done_at is null and (p_org is null or x.organization_id = p_org)
    and not exists (select 1 from pay_candidates pc where pc.organization_id = x.organization_id and pc.auto_key = x.auto_key);

  return n;
end;
$$;
select public.sync_payment_tasks();
