-- 0266 — File names (0265): the vendor's name is left out when it only repeats the number with a short tag
-- ("Confirmation 88198 – SO 88198" becomes "Confirmation 88198 – Oct 27, 2026"). Re-applied to every VMS-named file.

set local lock_timeout = '5s';

create or replace function public.vendor_link_std_name(p_kind text, p_number text, p_date date, p_orig text)
returns text language plpgsql immutable set search_path = public as $$
declare
  word text := case p_kind when 'confirmation' then 'Confirmation' when 'invoice' then 'Invoice' when 'credit' then 'Credit'
                 when 'order' then 'Our order' when 'packing_slip' then 'Packing slip' when 'delivery_receipt' then 'Delivery receipt'
                 when 'freight_bill' then 'Freight bill' when 'payment' then 'Payment' end;
  head  text;
  o     text;
  n_o   text;
  n_num text := lower(regexp_replace(coalesce(p_number, ''), '[^A-Za-z0-9]', '', 'g'));
begin
  if word is null then return null; end if;
  head := word || coalesce(' ' || nullif(trim(p_number), ''), '');
  -- the vendor's name for it, without the file type and without repeating the word in front
  o := trim(regexp_replace(coalesce(p_orig, ''), '\.[A-Za-z0-9]{2,5}$', ''));
  o := trim(regexp_replace(o, '^' || word || '[\s_:#–-]*', '', 'i'));
  n_o := lower(regexp_replace(o, '[^A-Za-z0-9]', '', 'g'));
  return left(head
    || case when n_o = '' or position(n_o in lower(regexp_replace(head, '[^A-Za-z0-9]', '', 'g'))) > 0
              or (n_num <> '' and length(replace(n_o, n_num, '')) <= 3 and position(n_num in n_o) > 0) then '' else ' – ' || o end
    || coalesce(' – ' || to_char(p_date, 'Mon FMDD, YYYY'), ''), 200);
end;
$$;

-- re-apply (the name trigger would read a new name as a hand rename, so it is off for this one update)
alter table public.vendor_links disable trigger vendor_links_z_name;
update public.vendor_links l set label = x.n
  from (select id, public.vendor_link_std_name(kind, doc_number, coalesce(doc_date, received_at, (created_at at time zone 'America/Los_Angeles')::date), orig_label) n
          from public.vendor_links where name_auto) x
 where x.id = l.id and x.n is not null and l.label is distinct from x.n;
alter table public.vendor_links enable trigger vendor_links_z_name;
