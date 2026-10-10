-- 0079 — Order paperwork checks start only for current paperwork: a confirmation or invoice saved by the bulk
-- import of old vendor files, or dated more than six months back, is filed but not checked (no Claude reading
-- years of history; Dana wants the checks on orders still coming in).
create or replace function public.order_check_from_document() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.kind not in ('confirmation', 'invoice') or new.storage_path is null then return new; end if;
  if new.source = 'import' or coalesce(new.doc_date, new.received_at, current_date) < current_date - 180 then return new; end if;
  insert into public.order_checks (organization_id, vendor_id, order_id, kind, document_id, email_id, assigned_to, assigned_at)
  values (new.organization_id, new.vendor_id, new.order_id, new.kind, new.id, new.email_id,
          case when new.order_id is not null then public.order_reviewer(new.order_id) end, case when new.order_id is not null then now() end)
  on conflict (document_id) do update set kind = excluded.kind, status = 'reading', reading = null, result = null
   where public.order_checks.kind <> excluded.kind and public.order_checks.status not in ('done', 'dismissed');
  return new;
end;
$$;
