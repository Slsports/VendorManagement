-- 0251: a file can belong to a rep group alone.
do $$
declare v_org uuid := '00000000-0000-0000-0000-000000000001'; v_rep uuid; v_link uuid;
begin
  insert into public.rep_groups (organization_id, name) values (v_org, 'Docs Test Reps 0251') returning id into v_rep;
  insert into public.vendor_links (organization_id, rep_group_id, kind, label, storage_path, source) values (v_org, v_rep, 'other', 'Show info', 'p/show.pdf', 'dropbox') returning id into v_link;
  if (select rep_group_id from public.vendor_links where id = v_link) <> v_rep then raise exception 'rep group link not kept'; end if;
  begin
    insert into public.vendor_links (organization_id, kind, label, storage_path) values (v_org, 'other', 'nobody', 'p/x.pdf');
    raise exception 'a file with no owner was accepted';
  exception when check_violation then null;
  end;
  insert into public.dropbox_files (organization_id, dropbox_id, path_lower, path_display, name, folder, status, target, rep_group_id) values (v_org, 'id:r1', '/x/r.pdf', '/X/r.pdf', 'r.pdf', '', 'proposed', 'rep', v_rep);
  delete from public.dropbox_files where dropbox_id = 'id:r1';
  delete from public.rep_groups where id = v_rep;
end $$;
