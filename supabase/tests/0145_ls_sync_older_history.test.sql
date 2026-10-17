\set ON_ERROR_STOP on
\pset footer off
\echo '>>> Older Lightspeed history: the sync row carries an older pass with its own cursors, set to the first copy''s start'
reset role;
insert into public.ls_sync (organization_id, backfill_from) values ('00000000-0000-0000-0000-000000000001', '2024-10-16T00:00:00Z') on conflict (organization_id) do update set backfill_from = excluded.backfill_from;
update public.ls_sync set older_to = backfill_from where older_to is null;
select older_to = backfill_from as older_to_is_first_start, older_sales_done, older_lines_done, older_rows, older_sales_cursor is null as no_cursor_yet from public.ls_sync where organization_id = '00000000-0000-0000-0000-000000000001';
delete from public.ls_sync where organization_id = '00000000-0000-0000-0000-000000000001';
