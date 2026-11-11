-- Receiving in one step (Dana, Nov 10): the sheet's rows (kind, From, Including, first and last book number) are the entry;
-- VMS makes the books from them. The check now reads those rows when the sheet has them (a box can come in several
-- ranges per kind), else the one range per kind it read before. "We don't usually look in every book … We have only had
-- an entire book missing": the check is the book count against the sheet's range, never the pages inside.
create or replace function public.snopark_shipment_check(p_shipment uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare sh public.snopark_shipments%rowtype; s public.snopark_seasons%rowtype; out jsonb := '[]'::jsonb; k text; per integer; b record; r record;
        v_from integer; v_to integer; v_books integer; n_books integer; lo integer; hi integer; covered integer; label text; has_rows boolean;
begin
  select * into sh from public.snopark_shipments where id = p_shipment and (auth.uid() is null or public.user_in_org(organization_id));
  if sh.id is null then raise exception 'Shipment not found' using errcode = '22023'; end if;
  select * into s from public.snopark_seasons where id = sh.season_id;
  has_rows := coalesce(jsonb_typeof(sh.sheet->'rows') = 'array' and jsonb_array_length(sh.sheet->'rows') > 0, false);
  -- every book entered is a whole book
  for b in select kind, book_number, first_permit, last_permit from public.snopark_books where shipment_id = p_shipment order by kind, first_permit loop
    per := case when b.kind = 'day' then s.day_per_book else s.season_per_book end;
    if b.last_permit - b.first_permit + 1 <> per then
      out := out || jsonb_build_object('kind', b.kind, 'text', format('%s book %s holds %s permits (%s-%s); a %s book holds %s.', initcap(b.kind), b.book_number, b.last_permit - b.first_permit + 1, b.first_permit, b.last_permit, b.kind, per));
    end if;
  end loop;
  if sh.sheet_confirmed_at is not null then
    -- each range on the sheet: whole books, and the books entered cover exactly that range
    for r in
      select x.kind, x.v_from, x.v_to, x.v_books from (
        select e->>'kind' as kind, nullif(e->>'from', '')::integer as v_from, nullif(e->>'to', '')::integer as v_to, nullif(e->>'books', '')::integer as v_books
          from jsonb_array_elements(case when has_rows then sh.sheet->'rows' else '[]'::jsonb end) e
        union all
        select k2, nullif(sh.sheet->k2->>'from', '')::integer, nullif(sh.sheet->k2->>'to', '')::integer, nullif(sh.sheet->k2->>'books', '')::integer
          from unnest(array['day', 'season']) k2 where not has_rows
      ) x where x.kind in ('day', 'season') and x.v_from is not null and x.v_to is not null
    loop
      per := case when r.kind = 'day' then s.day_per_book else s.season_per_book end;
      label := initcap(r.kind);
      if (r.v_to - r.v_from + 1) % per <> 0 then
        out := out || jsonb_build_object('kind', r.kind, 'text', format('The sheet''s %s range %s to %s is %s permits, which is not a whole number of books of %s (%s books). Ask the State before entering it.', r.kind, r.v_from, r.v_to, r.v_to - r.v_from + 1, per, round((r.v_to - r.v_from + 1)::numeric / per, 1)));
        continue;
      end if;
      if r.v_books is not null and (r.v_to - r.v_from + 1) / per <> r.v_books then
        out := out || jsonb_build_object('kind', r.kind, 'text', format('The sheet says %s %s books, but permits %s to %s are %s books of %s.', r.v_books, r.kind, r.v_from, r.v_to, (r.v_to - r.v_from + 1) / per, per));
      end if;
      select count(*), coalesce(sum(least(last_permit, r.v_to) - greatest(first_permit, r.v_from) + 1), 0) into n_books, covered
        from public.snopark_books where shipment_id = p_shipment and kind = r.kind and first_permit <= r.v_to and last_permit >= r.v_from;
      if n_books = 0 then
        out := out || jsonb_build_object('kind', r.kind, 'text', format('The sheet lists %s permits %s to %s; no %s books were entered for them.', r.kind, r.v_from, r.v_to, r.kind));
      elsif covered < r.v_to - r.v_from + 1 then
        out := out || jsonb_build_object('kind', r.kind, 'text', format('%s permits in the sheet''s %s range (%s to %s) are not in any book entered: a book is missing from the box.', (r.v_to - r.v_from + 1) - covered, r.kind, r.v_from, r.v_to));
      end if;
      if r.v_books is not null and n_books <> r.v_books then
        out := out || jsonb_build_object('kind', r.kind, 'text', format('The sheet says %s %s books were issued; %s entered.', r.v_books, r.kind, n_books));
      end if;
    end loop;
    -- books entered outside every range on the sheet
    foreach k in array array['day', 'season'] loop
      select count(*) into n_books from public.snopark_books b2 where b2.shipment_id = p_shipment and b2.kind = k
        and not exists (
          select 1 from (
            select nullif(e->>'from', '')::integer f, nullif(e->>'to', '')::integer t from jsonb_array_elements(case when has_rows then sh.sheet->'rows' else '[]'::jsonb end) e where e->>'kind' = k
            union all
            select nullif(sh.sheet->k->>'from', '')::integer, nullif(sh.sheet->k->>'to', '')::integer where not has_rows
          ) rg where rg.f is not null and rg.t is not null and b2.first_permit >= rg.f and b2.last_permit <= rg.t);
      if n_books > 0 then
        out := out || jsonb_build_object('kind', k, 'text', format('%s %s book%s entered outside the sheet''s ranges.', n_books, k, case when n_books = 1 then ' is' else 's are' end));
      end if;
    end loop;
  end if;
  if sh.status <> 'done' then
    update public.snopark_shipments set differences = out,
           status = case when sh.sheet_confirmed_at is null then 'open' when jsonb_array_length(out) = 0 and exists (select 1 from public.snopark_books where shipment_id = p_shipment) then 'balanced' when jsonb_array_length(out) > 0 then 'off' else 'open' end
     where id = p_shipment;
  end if;
  return out;
end $$;
