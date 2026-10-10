-- =============================================================================
-- 0003 — Store aliases seen in Dana's spreadsheets
-- The Mountain Milk remittance sheet labels stores TOWN (Shaver Lake Sports) and
-- MARINA (Shaver Lake Marina). HAPPY / HC for GS were already seeded in 0001.
-- Aliases are matched case-insensitively on import.
-- =============================================================================
update public.stores
set aliases = array(select distinct unnest(aliases || '{TOWN}'::text[]))
where organization_id = '00000000-0000-0000-0000-000000000001' and code = 'SLS';

update public.stores
set aliases = array(select distinct unnest(aliases || '{MARINA}'::text[]))
where organization_id = '00000000-0000-0000-0000-000000000001' and code = 'SLM';
