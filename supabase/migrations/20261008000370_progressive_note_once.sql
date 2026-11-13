-- 0370 — The Progressive card's merge (0367) carried Drive's note over, which was the same line Progressive already had; keep it once.
update public.accounting_contacts
   set notes = (select string_agg(l, E'\n' order by n) from (select l, min(n) n from unnest(string_to_array(notes, E'\n')) with ordinality as t(l, n) group by l) x)
 where company = 'Progressive' and merged_into is null and notes like '%Also Drive Insurance%';
