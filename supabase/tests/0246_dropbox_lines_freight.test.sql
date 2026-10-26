-- 0246: a Dropbox file may point at a line or a freight bill.
do $$
declare v_org uuid := '00000000-0000-0000-0000-000000000001'; v_line uuid;
begin
  select id into v_line from public.vendor_directory limit 1;
  if v_line is null then insert into public.vendor_directory (organization_id, name) values (v_org, 'Dropbox Test Line') returning id into v_line; end if;
  insert into public.dropbox_files (organization_id, dropbox_id, path_lower, path_display, name, folder, status, target, line_id, kind)
    values (v_org, 'id:l1', '/x/a.pdf', '/X/a.pdf', 'a.pdf', '', 'proposed', 'line', v_line, 'order_form');
  if (select target from public.dropbox_files where dropbox_id = 'id:l1') <> 'line' then raise exception 'line target not kept'; end if;
  begin
    insert into public.dropbox_files (organization_id, dropbox_id, path_lower, path_display, name, folder, status, target) values (v_org, 'id:l2', '/x/b.pdf', '/X/b.pdf', 'b.pdf', '', 'proposed', 'elsewhere');
    raise exception 'bad target accepted';
  exception when check_violation then null;
  end;
  delete from public.dropbox_files where organization_id = v_org and dropbox_id like 'id:l%';
end $$;
