-- 0240 — Paid invoices, and vendors whose paperwork is only filed (Dana, Oct 24, Rossignol): "I received an email from
-- tyler saying that he paid them on the portal. They should be showing us paid." And: "Rossignol invoices don't need an
-- order … Tyler places those orders on the rossignol website, the confirmation goes to only him, then after he receives
-- them, he pays them on the rossignol portal. Vms just needs to file the paperwork accurately."
--
--   • vendor_links.paid_at / paid_how / paid_email_id / paid_thread_id: an invoice VMS knows is paid shows "Paid", with
--     the date, how, and the email one click away.
--   • payment_notices: shared mail that may say invoices were paid (a vendor's bill-pay receipt, our "I paid these"), read
--     once by Claude (mail-commands). The invoices it names, or the invoices attached to it, are marked paid. Numbers not
--     on file yet are kept, so the invoice is marked when it is filed later. Private and Accounting mail are never read.
--   • vendors.no_order_checks: orders for this vendor aren't kept in VMS; their confirmations and invoices are filed, with
--     no order check ("Which order?"). Rossignol is ticked; its open checks are closed.
--   • Back-check: shared vendor mail from the last 12 months that talks about payment is queued for Claude.

set local lock_timeout = '5s';

alter table public.vendor_links add column if not exists paid_at date;
alter table public.vendor_links add column if not exists paid_how text;
alter table public.vendor_links add column if not exists paid_email_id uuid;
alter table public.vendor_links add column if not exists paid_thread_id uuid;
comment on column public.vendor_links.paid_at is 'The invoice was paid on this date, from a payment email VMS read (Dana, Oct 24).';
comment on column public.vendor_links.paid_how is 'How it was paid, in plain words ("Rossignol bill pay").';

alter table public.vendors add column if not exists no_order_checks boolean not null default false;
comment on column public.vendors.no_order_checks is 'Orders for this vendor are not kept in VMS: their confirmations and invoices are filed with no order check (Rossignol, Oct 24).';

create table if not exists public.payment_notices (
  email_id         uuid primary key references public.emails(id) on delete cascade,
  organization_id  uuid not null references public.organizations(id) on delete cascade,
  vendor_id        uuid not null references public.vendors(id) on delete cascade,
  read_at          timestamptz,
  is_payment       boolean,
  paid_on          date,
  how              text,
  numbers          text[] not null default '{}',
  attached         boolean not null default false,
  unmatched        text[] not null default '{}',
  marked           integer not null default 0,
  note             text,
  created_at       timestamptz not null default now()
);
comment on table public.payment_notices is 'Shared vendor mail that may say invoices were paid, read once by Claude (Dana, Oct 24).';
alter table public.payment_notices enable row level security;
drop policy if exists "payment_notices: members read" on public.payment_notices;
create policy "payment_notices: members read" on public.payment_notices for select to authenticated using (public.user_in_org(organization_id));
grant select on public.payment_notices to authenticated;
grant all on public.payment_notices to service_role;

-- the mail that may be about a payment: shared (never private or Accounting), filed to a vendor
create or replace function public.payment_notice_candidates(p_org uuid, p_since timestamptz)
returns table (email_id uuid, vendor_id uuid)
language sql stable security definer set search_path = public as $$
  select e.id, e.vendor_id
    from public.emails e
    left join public.email_threads t on t.id = e.thread_id
    left join public.mailboxes m on m.id = e.mailbox_id
   where e.organization_id = p_org and e.vendor_id is not null and e.copy_of is null and e.received_at > p_since
     and (e.mailbox_id is null or t.shared_at is not null) and coalesce(m.kind::text, '') <> 'accounting'
     and (e.subject ~* '(\mpaid\M|payment|remittance|bill ?pay)'
          or e.body_text ~* '(have been paid|has been paid|been paid through|we paid|i paid|payment (has been |was )?(sent|initiated|made|submitted|processed|received)|paid (in full|through|via|on the|online)|remittance)')
     and not exists (select 1 from public.payment_notices n where n.email_id = e.id)
$$;
revoke execute on function public.payment_notice_candidates(uuid, timestamptz) from public, anon, authenticated;

create or replace function public.payment_notices_find(p_org uuid) returns integer
language plpgsql security definer set search_path = public as $$
declare n integer;
begin
  insert into public.payment_notices (email_id, organization_id, vendor_id)
  select c.email_id, p_org, c.vendor_id from public.payment_notice_candidates(p_org, now() - interval '3 days') c
  on conflict (email_id) do nothing;
  get diagnostics n = row_count;
  return n;
end;
$$;
revoke execute on function public.payment_notices_find(uuid) from public, anon, authenticated;
grant execute on function public.payment_notices_find(uuid) to service_role;

-- mark one invoice paid from a notice (never over an earlier paid mark)
create or replace function public.invoice_mark_paid(p_link uuid, n public.payment_notices) returns boolean
language plpgsql security definer set search_path = public as $$
begin
  update public.vendor_links l set paid_at = coalesce(n.paid_on, (select received_at::date from public.emails where id = n.email_id)),
         paid_how = n.how, paid_email_id = n.email_id, paid_thread_id = (select thread_id from public.emails where id = n.email_id)
   where l.id = p_link and l.kind = 'invoice' and l.paid_at is null;
  return found;
end;
$$;
revoke execute on function public.invoice_mark_paid(uuid, public.payment_notices) from public, anon, authenticated;

/**
 * Claude's reading of one email: is it a payment, when, how, which invoice numbers, and whether the invoices attached
 * to it are the paid ones. Marks the vendor's invoices on file; keeps the numbers not on file yet.
 */
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
  end if;
  return v_marked;
end;
$$;
revoke execute on function public.payment_notice_read(uuid, boolean, date, text, text[], boolean, text) from public, anon, authenticated;
grant execute on function public.payment_notice_read(uuid, boolean, date, text, text[], boolean, text) to service_role;

-- an invoice filed after its payment email: its number was named, or it came attached to that email
create or replace function public.vendor_links_paid_later() returns trigger
language plpgsql security definer set search_path = public as $$
declare n public.payment_notices%rowtype;
begin
  if new.kind <> 'invoice' or new.paid_at is not null then return null; end if;
  select * into n from public.payment_notices p
   where p.vendor_id = new.vendor_id and p.is_payment
     and ((new.doc_number is not null and public.po_norm(new.doc_number) = any (select public.po_norm(y) from unnest(p.unmatched) y))
          or (p.attached and p.email_id = new.email_id))
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
drop trigger if exists vendor_links_paid_later on public.vendor_links;
create trigger vendor_links_paid_later after insert or update of kind, doc_number on public.vendor_links for each row execute function public.vendor_links_paid_later();

-- paperwork only: no order check for vendors whose orders aren't kept in VMS
create or replace function public.order_check_from_document() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.kind not in ('confirmation', 'invoice') or new.storage_path is null then return new; end if;
  if exists (select 1 from public.vendors v where v.id = new.vendor_id and (v.is_delivery_vendor or v.no_order_checks)) then return new; end if;
  insert into public.order_checks (organization_id, vendor_id, order_id, kind, document_id, email_id, assigned_to, assigned_at)
  values (new.organization_id, new.vendor_id, new.order_id, new.kind, new.id, new.email_id,
          case when new.order_id is not null then public.order_reviewer(new.order_id) end, case when new.order_id is not null then now() end)
  on conflict (document_id) do update set kind = excluded.kind, status = 'reading', reading = null, result = null
   where public.order_checks.kind <> excluded.kind and public.order_checks.status not in ('done', 'dismissed');
  return new;
end;
$$;

-- Rossignol: paperwork only; its open checks closed
update public.vendors set no_order_checks = true where id = '37dd4e44-b4fb-4d7a-934f-eee6b76d8ea6';
update public.order_checks c set status = 'dismissed', working_at = null,
       read_note = 'Rossignol orders aren''t kept in VMS (Tyler orders and pays on their website): the paper is filed, no order check (Dana, Oct 24).'
  from public.vendors v
 where v.id = c.vendor_id and v.no_order_checks and c.status not in ('done', 'dismissed', 'not_paperwork');

-- Back-check: the last 12 months of shared vendor mail that talks about payment, for Claude to read
insert into public.payment_notices (email_id, organization_id, vendor_id)
select c.email_id, o.id, c.vendor_id from public.organizations o, public.payment_notice_candidates(o.id, now() - interval '12 months') c
on conflict (email_id) do nothing;
