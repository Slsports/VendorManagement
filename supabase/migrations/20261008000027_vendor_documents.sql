-- 0048 — Vendor documents in folders (Dana, Oct 8): the vendor page's files become a Documents area with
-- folders (Price lists, Catalogs, Invoices, Order forms, Show specials, Shipping, Other) and a year folder
-- inside each, the way Dana files them ("Stansport/Invoices/2026"). The folder follows the kind; the year
-- is doc_year: the season's year ("Fall 2026"), else the date on the file or the day it arrived. Moving a
-- file sets its kind and year.
alter table public.vendor_links add column if not exists doc_year integer check (doc_year between 1990 and 2100);
comment on column public.vendor_links.doc_year is 'Year folder in the vendor''s documents: the season''s year, else the date it is for or arrived.';

create or replace function public.vendor_link_year(p_season text, p_received date, p_created timestamptz)
returns integer language sql immutable as $$
  select coalesce(
    (regexp_match(coalesce(p_season, ''), '(20\d\d)'))[1]::integer,
    extract(year from p_received)::integer,
    extract(year from coalesce(p_created, now()))::integer)
$$;

update public.vendor_links set doc_year = public.vendor_link_year(season_label, received_at, created_at) where doc_year is null;

create or replace function public.vendor_links_year()
returns trigger language plpgsql as $$
begin
  if new.doc_year is null then new.doc_year := public.vendor_link_year(new.season_label, new.received_at, new.created_at); end if;
  return new;
end;
$$;
drop trigger if exists vendor_links_year on public.vendor_links;
create trigger vendor_links_year before insert on public.vendor_links for each row execute function public.vendor_links_year();

-- Move a document to another folder (kind) and year; "current" is worked out again for both kinds.
create or replace function public.move_vendor_document(p_link uuid, p_kind text, p_year integer)
returns void
language plpgsql security definer
set search_path = public
as $$
declare
  l public.vendor_links%rowtype;
begin
  if not public.user_can_edit() then raise exception 'Only admins, managers and buyers file documents' using errcode = '42501'; end if;
  select * into l from public.vendor_links where id = p_link for update;
  if l.id is null or not public.user_in_org(l.organization_id) then raise exception 'Document not found' using errcode = '23503'; end if;
  update public.vendor_links set kind = p_kind, doc_year = coalesce(p_year, doc_year), is_current = false where id = p_link;
  if l.vendor_id is not null then
    perform public.vendor_links_mark_current(l.vendor_id, l.kind);
    if p_kind <> l.kind then perform public.vendor_links_mark_current(l.vendor_id, p_kind); end if;
  end if;
end;
$$;
revoke execute on function public.move_vendor_document(uuid, text, integer) from public, anon;
grant execute on function public.move_vendor_document(uuid, text, integer) to authenticated, service_role;
