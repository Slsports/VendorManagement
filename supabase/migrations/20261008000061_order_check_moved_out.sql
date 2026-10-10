-- 0082 — Moving files between folders (Dana, Oct 10: "move a file to a different folder if Claude puts it in the
-- wrong one"). A file moved into Confirmations or Invoices starts a check (as before); one moved out of them has
-- its unfinished check set aside.
create or replace function public.order_check_from_document() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'UPDATE' and old.kind in ('confirmation', 'invoice') and new.kind not in ('confirmation', 'invoice') then
    update public.order_checks set status = 'dismissed', working_at = null, read_note = 'Moved out of ' || case when old.kind = 'invoice' then 'Invoices' else 'Confirmations' end
     where document_id = new.id and status not in ('done', 'dismissed');
    return new;
  end if;
  if new.kind not in ('confirmation', 'invoice') or new.storage_path is null then return new; end if;
  if new.source = 'import' or coalesce(new.doc_date, new.received_at, current_date) < current_date - 180 then return new; end if;
  insert into public.order_checks (organization_id, vendor_id, order_id, kind, document_id, email_id, assigned_to, assigned_at)
  values (new.organization_id, new.vendor_id, new.order_id, new.kind, new.id, new.email_id,
          case when new.order_id is not null then public.order_reviewer(new.order_id) end, case when new.order_id is not null then now() end)
  on conflict (document_id) do update set kind = excluded.kind, status = 'reading', reading = null, result = null, read_note = null
   where public.order_checks.kind <> excluded.kind or public.order_checks.status = 'dismissed';
  return new;
end;
$$;
