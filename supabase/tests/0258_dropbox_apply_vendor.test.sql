-- 0258: picking a vendor for one Dropbox file files the others read as the same name under it and adds the alias.
do $$
declare v_org uuid := '00000000-0000-0000-0000-000000000001'; v_vendor uuid; v_conn uuid; f1 uuid; f2 uuid; f3 uuid; f4 uuid; v_n int;
begin
  perform set_config('request.jwt.claims', '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}', true);
  insert into public.vendors (organization_id, name) values (v_org, 'PACIFIC STIHL TEST 0258') returning id into v_vendor;
  insert into public.dropbox_files (organization_id, dropbox_id, path_lower, path_display, name, folder, status, target, vendor_said, kind)
    values (v_org, 'id:0258a', '/a/1.pdf', '/A/1.pdf', '1.pdf', '/A', 'leftover', 'vendor', 'Pacific STIHL', 'invoice') returning id into f1;
  insert into public.dropbox_files (organization_id, dropbox_id, path_lower, path_display, name, folder, status, target, vendor_said, kind)
    values (v_org, 'id:0258b', '/a/2.pdf', '/A/2.pdf', '2.pdf', '/A', 'leftover', 'vendor', 'pacific stihl ', 'statement') returning id into f2;
  insert into public.dropbox_files (organization_id, dropbox_id, path_lower, path_display, name, folder, status, target, vendor_said, kind)
    values (v_org, 'id:0258c', '/a/3.pdf', '/A/3.pdf', '3.pdf', '/A', 'leftover', 'vendor', 'Someone Else', 'invoice') returning id into f3;
  insert into public.dropbox_files (organization_id, dropbox_id, path_lower, path_display, name, folder, status, target, vendor_said, kind)
    values (v_org, 'id:0258d', '/a/4.pdf', '/A/4.pdf', '4.pdf', '/A', 'skipped', 'skip', 'Pacific STIHL', 'invoice') returning id into f4;
  if public.dropbox_same_vendor_count(f1) <> 1 then raise exception 'same-vendor count wrong: %', public.dropbox_same_vendor_count(f1); end if;
  v_n := public.dropbox_apply_vendor(f1, v_vendor, 'invoice', true);
  if v_n <> 2 then raise exception 'expected 2 approved, got %', v_n; end if;
  if (select status from public.dropbox_files where id = f2) <> 'approved' or (select vendor_id from public.dropbox_files where id = f2) <> v_vendor then raise exception 'the twin was not filed'; end if;
  if (select kind from public.dropbox_files where id = f2) <> 'statement' then raise exception 'the twin lost its folder'; end if;
  if (select status from public.dropbox_files where id = f3) <> 'leftover' then raise exception 'another vendor''s file was touched'; end if;
  if (select status from public.dropbox_files where id = f4) <> 'skipped' then raise exception 'a skipped file was touched'; end if;
  if not exists (select 1 from public.vendors v where v.id = v_vendor and 'Pacific STIHL' = any (v.aliases)) then raise exception 'alias not added'; end if;
  -- again: no second alias
  perform public.dropbox_apply_vendor(f3, v_vendor, 'invoice', true);
  if (select array_length(aliases, 1) from public.vendors where id = v_vendor) <> 2 then raise exception 'alias count wrong'; end if;
  delete from public.dropbox_files where organization_id = v_org and dropbox_id like 'id:0258%';
  delete from public.vendors where id = v_vendor;
  perform set_config('request.jwt.claims', '', true);
end $$;
