-- 0027 — Files and links save themselves (docs/orders-and-mail-plan.md §2). Price lists, catalogs,
-- specials and order forms that arrive by email are copied into the vendor's Catalogs, price lists &
-- files with the email linked; catalog and price-list links in offers mail are saved as links. Nothing is
-- deleted: per vendor and kind the newest is current, older ones stay as history.

alter table public.vendor_links add column if not exists email_id uuid references public.emails(id) on delete set null;
alter table public.vendor_links add column if not exists is_current boolean not null default true;
comment on column public.vendor_links.is_current is 'Newest of its kind for the vendor (catalog, price list, specials, order form). Older ones stay as history.';
create index if not exists vendor_links_email_idx on public.vendor_links (email_id);

alter table public.emails add column if not exists files_scanned_at timestamptz;
comment on column public.emails.files_scanned_at is 'When the sync looked for files and links to save from this email.';
create index if not exists emails_files_queue_idx on public.emails (organization_id, received_at desc)
  where files_scanned_at is null and vendor_id is not null and direction = 'in';

-- Per vendor and kind, only the newest (by date received, then added) is current.
create or replace function public.vendor_links_mark_current(p_vendor uuid, p_kind text)
returns void
language sql security definer
set search_path = public
as $$
  update public.vendor_links l set is_current = (l.id = n.id)
    from (select id from public.vendor_links
           where vendor_id = p_vendor and kind = p_kind
           order by coalesce(received_at, created_at::date) desc, created_at desc limit 1) n
   where l.vendor_id = p_vendor and l.kind = p_kind and p_kind in ('catalog', 'price_list', 'specials', 'order_form')
     and l.is_current is distinct from (l.id = n.id);
$$;

create or replace function public.vendor_links_after_insert()
returns trigger
language plpgsql security definer
set search_path = public
as $$
begin
  if new.vendor_id is not null then perform public.vendor_links_mark_current(new.vendor_id, new.kind); end if;
  return null;
end;
$$;
drop trigger if exists vendor_links_current on public.vendor_links;
create trigger vendor_links_current after insert on public.vendor_links for each row execute function public.vendor_links_after_insert();

grant execute on function public.vendor_links_mark_current(uuid, text) to authenticated, service_role;

-- What is on file today: mark current per vendor and kind.
do $$ declare r record; begin
  for r in select distinct vendor_id, kind from public.vendor_links where vendor_id is not null loop
    perform public.vendor_links_mark_current(r.vendor_id, r.kind);
  end loop;
end $$;
