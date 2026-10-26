-- 0244: Dropbox files list, the folder summary, approval by the admin only, and the new 'dropbox' sources.
do $$
declare v_org uuid := '00000000-0000-0000-0000-000000000001'; v_admin uuid; v_vendor uuid; v_n integer; v_row record;
begin
  select id into v_admin from public.profiles where organization_id = v_org and role = 'admin' and is_active order by created_at limit 1;
  insert into auth.users (id, email) values ('11111111-2222-3333-4444-555555555555', 'mbx-mgr@example.com') on conflict do nothing;
  insert into public.profiles (id, organization_id, email, full_name, role, is_active) values ('11111111-2222-3333-4444-555555555555', v_org, 'mbx-mgr@example.com', 'Morgan Test', 'manager', true) on conflict (id) do update set role = 'manager', organization_id = excluded.organization_id, is_active = true;
  select id into v_vendor from public.vendors where organization_id = v_org limit 1;
  if v_vendor is null then insert into public.vendors (organization_id, name) values (v_org, 'Dropbox Test Vendor') returning id into v_vendor; end if;
  insert into public.dropbox_files (organization_id, dropbox_id, path_lower, path_display, name, folder, status, target, vendor_id, kind, sure)
    values (v_org, 'id:a1', '/sls/invoices/a.pdf', '/SLS/Invoices/a.pdf', 'a.pdf', 'Invoices', 'proposed', 'vendor', v_vendor, 'invoice', true),
           (v_org, 'id:a2', '/sls/invoices/b.pdf', '/SLS/Invoices/b.pdf', 'b.pdf', 'Invoices', 'proposed', 'vendor', v_vendor, 'invoice', false),
           (v_org, 'id:a3', '/sls/taxes/c.pdf', '/SLS/Taxes/c.pdf', 'c.pdf', 'Taxes', 'leftover', null, null, null, false);
  select * into v_row from public.dropbox_folder_summary(v_org) where folder = 'Invoices';
  if v_row.total <> 2 or v_row.proposed <> 2 or v_row.sure_proposed <> 1 then raise exception 'folder summary wrong: %', v_row; end if;

  -- the admin approves the sure ones in a folder
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  v_n := public.dropbox_approve(v_org, 'Invoices', null, true);
  if v_n <> 1 then raise exception 'expected 1 sure approval, got %', v_n; end if;
  if (select status from public.dropbox_files where dropbox_id = 'id:a1') <> 'approved' then raise exception 'sure file not approved'; end if;
  if (select status from public.dropbox_files where dropbox_id = 'id:a2') <> 'proposed' then raise exception 'unsure file should stay proposed'; end if;
  v_n := public.dropbox_approve(v_org, null, array[(select id from public.dropbox_files where dropbox_id = 'id:a2')], false);
  if v_n <> 1 then raise exception 'expected the unsure file approved by id'; end if;

  -- a non-admin may not approve
  perform set_config('request.jwt.claims', json_build_object('sub', '11111111-2222-3333-4444-555555555555', 'role', 'authenticated')::text, true);
  begin
    perform public.dropbox_approve(v_org, 'Invoices', null, false);
    raise exception 'a non-admin approved';
  exception when others then
    if sqlerrm not like 'Only the admin%' then raise; end if;
  end;
  perform set_config('request.jwt.claims', '', true);

  -- the new sources are accepted
  insert into public.vendor_links (organization_id, vendor_id, kind, label, storage_path, source, dropbox_path) values (v_org, v_vendor, 'invoice', 'x', 'p/x.pdf', 'dropbox', '/SLS/Invoices/a.pdf');
  delete from public.vendor_links where dropbox_path = '/SLS/Invoices/a.pdf';
  delete from public.dropbox_files where organization_id = v_org and dropbox_id like 'id:a%';
end $$;
