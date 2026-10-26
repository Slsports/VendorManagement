-- 0245: top_folder, the per-top-folder summary, and skipping / unskipping a whole folder (admin only).
do $$
declare v_org uuid := '00000000-0000-0000-0000-000000000001'; v_admin uuid; v_n integer; v_row record;
begin
  select id into v_admin from public.profiles where organization_id = v_org and role = 'admin' and is_active order by created_at limit 1;
  insert into public.dropbox_files (organization_id, dropbox_id, path_lower, path_display, name, folder, status)
    values (v_org, 'id:t1', '/x/debby files/2021/a.pdf', '/X/Debby Files/2021/a.pdf', 'a.pdf', 'Debby Files/2021', 'new'),
           (v_org, 'id:t2', '/x/debby files/b.pdf', '/X/Debby Files/b.pdf', 'b.pdf', 'Debby Files', 'proposed'),
           (v_org, 'id:t3', '/x/1-vendors/c.pdf', '/X/1-Vendors/c.pdf', 'c.pdf', '1-Vendors', 'new'),
           (v_org, 'id:t4', '/x/d.pdf', '/X/d.pdf', 'd.pdf', '', 'new');
  if (select top_folder from public.dropbox_files where dropbox_id = 'id:t1') <> 'Debby Files' then raise exception 'top_folder wrong'; end if;
  if (select top_folder from public.dropbox_files where dropbox_id = 'id:t4') <> '' then raise exception 'top_folder at the top should be empty'; end if;
  select * into v_row from public.dropbox_top_summary(v_org) where folder = 'Debby Files';
  if v_row.total <> 2 or v_row.new_count <> 1 or v_row.proposed <> 1 then raise exception 'top summary wrong: %', v_row; end if;

  perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  v_n := public.dropbox_skip_folder(v_org, 'Debby Files', true);
  if v_n <> 2 then raise exception 'expected 2 skipped, got %', v_n; end if;
  if (select count(*) from public.dropbox_files where top_folder = 'Debby Files' and status = 'skipped' and skip_reason = 'folder skipped') <> 2 then raise exception 'folder not skipped'; end if;
  if (select status from public.dropbox_files where dropbox_id = 'id:t3') <> 'new' then raise exception 'another folder was touched'; end if;
  select * into v_row from public.dropbox_top_summary(v_org) where folder = 'Debby Files';
  if v_row.folder_skipped <> 2 then raise exception 'folder_skipped count wrong'; end if;
  v_n := public.dropbox_skip_folder(v_org, 'Debby Files', false);
  if v_n <> 2 or (select count(*) from public.dropbox_files where top_folder = 'Debby Files' and status = 'new') <> 2 then raise exception 'unskip failed'; end if;
  perform set_config('request.jwt.claims', '', true);
  delete from public.dropbox_files where organization_id = v_org and dropbox_id like 'id:t%';
end $$;
