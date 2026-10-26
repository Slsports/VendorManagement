-- 0245 — Dropbox read, after the first real listing (Dana, Oct 26: 13,000 files in 40 top folders, many not for VMS).
-- • top_folder: the first folder under the one VMS reads, so the page groups by it and Dana can skip whole folders
--   (Debby Files, Employees, Payroll, Websites …) before any reading is paid for.
-- • dropbox_skip_folder: Dana's choice per top folder; "read it" puts the files back.
-- • .docx files are read as their words (docxText.ts); old .doc files (Word 97-2003) are set aside.
-- • The scheduler runs every minute so 10,000 files read in hours, not days.
alter table public.dropbox_files add column if not exists top_folder text generated always as (split_part(folder, '/', 1)) stored;
create index if not exists dropbox_files_top_idx on public.dropbox_files (organization_id, top_folder, status);

create or replace function public.dropbox_top_summary(p_org uuid)
returns table (folder text, total bigint, new_count bigint, proposed bigint, leftover bigint, approved bigint, filed bigint, linked bigint, skipped bigint, errors bigint, sure_proposed bigint, folder_skipped bigint)
language sql stable security invoker set search_path = public as $$
  select f.top_folder, count(*),
    count(*) filter (where f.status = 'new'), count(*) filter (where f.status = 'proposed'), count(*) filter (where f.status = 'leftover'),
    count(*) filter (where f.status = 'approved'), count(*) filter (where f.status = 'filed'), count(*) filter (where f.status = 'linked'),
    count(*) filter (where f.status = 'skipped'), count(*) filter (where f.status = 'error'), count(*) filter (where f.status = 'proposed' and f.sure),
    count(*) filter (where f.status = 'skipped' and f.skip_reason = 'folder skipped')
  from public.dropbox_files f where f.organization_id = p_org group by f.top_folder order by count(*) desc
$$;
revoke execute on function public.dropbox_top_summary(uuid) from public, anon;
grant execute on function public.dropbox_top_summary(uuid) to authenticated, service_role;

create or replace function public.dropbox_skip_folder(p_org uuid, p_top text, p_skip boolean)
returns integer language plpgsql security definer set search_path = public as $$
declare v_n integer;
begin
  if not public.is_admin() or not public.user_in_org(p_org) then raise exception 'Only the admin decides Dropbox folders'; end if;
  if p_skip then
    update public.dropbox_files set status = 'skipped', skip_reason = 'folder skipped', decided_by = auth.uid(), decided_at = now(), updated_at = now()
    where organization_id = p_org and top_folder = p_top and status in ('new', 'proposed', 'leftover', 'error');
  else
    update public.dropbox_files set status = 'new', skip_reason = null, decided_by = auth.uid(), decided_at = now(), updated_at = now()
    where organization_id = p_org and top_folder = p_top and status = 'skipped' and skip_reason = 'folder skipped';
  end if;
  get diagnostics v_n = row_count;
  return v_n;
end $$;
revoke execute on function public.dropbox_skip_folder(uuid, text, boolean) from public, anon;
grant execute on function public.dropbox_skip_folder(uuid, text, boolean) to authenticated;

-- Old .doc files already listed are set aside the same way the function now does it.
update public.dropbox_files set status = 'skipped', skip_reason = 'old Word .doc file: save it as .docx or PDF to read it' where status = 'new' and name ~* '\.doc$';

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') and exists (select 1 from pg_extension where extname = 'pg_net') then
    perform cron.unschedule(jobid) from cron.job where jobname = 'dropbox-sync';
    perform cron.schedule('dropbox-sync', '* * * * *',
      $job$select net.http_post(url := 'https://bpdpkytfmpbwpbmpejbf.supabase.co/functions/v1/dropbox', headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'mail_cron_secret')), body := '{"action":"sync"}'::jsonb, timeout_milliseconds := 120000)$job$);
  end if;
end $$;

-- Approval by top folder (the page groups by it now).
drop function if exists public.dropbox_approve(uuid, text, uuid[], boolean);
create or replace function public.dropbox_approve(p_org uuid, p_top text default null, p_ids uuid[] default null, p_sure_only boolean default true)
returns integer language plpgsql security definer set search_path = public as $$
declare v_n integer;
begin
  if not public.is_admin() or not public.user_in_org(p_org) then raise exception 'Only the admin approves Dropbox filing'; end if;
  update public.dropbox_files set status = 'approved', decided_by = auth.uid(), decided_at = now(), updated_at = now()
  where organization_id = p_org and status = 'proposed'
    and (p_ids is null or id = any(p_ids))
    and (p_top is null or top_folder = p_top)
    and (not p_sure_only or sure);
  get diagnostics v_n = row_count;
  return v_n;
end $$;
revoke execute on function public.dropbox_approve(uuid, text, uuid[], boolean) from public, anon;
grant execute on function public.dropbox_approve(uuid, text, uuid[], boolean) to authenticated;
