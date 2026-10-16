-- 0123 — The hosted project forbids deleting storage rows from SQL ("Use the Storage API instead"), so taking a
-- contact's papers back out returns the files' paths and whoever called (the app, the filing function) removes them
-- from the bucket.
drop function if exists public.accounting_apply_contact_filing(uuid);
create or replace function public.accounting_apply_contact_filing(p_contact uuid) returns text[]
language plpgsql security definer set search_path = public as $$
declare c public.accounting_contacts%rowtype; v_note text; r record; paths text[] := '{}';
begin
  if auth.uid() is not null and not public.sees_accounting() then raise exception 'Accounting only' using errcode = '42501'; end if;
  select * into c from public.accounting_contacts where id = p_contact;
  if not found then return paths; end if;
  v_note := coalesce(nullif(trim(c.filing_note), ''), 'handled elsewhere');
  if c.filing = 'skip' then
    for r in
      select d.id, d.storage_path from public.accounting_documents d
        join public.emails e on e.id = d.email_id
        join public.email_threads t on t.id = e.thread_id
       where d.organization_id = c.organization_id and t.accounting_contact_id = c.id
    loop
      update public.email_attachments set accounting_document_id = null, accounting_skip = v_note where accounting_document_id = r.id;
      delete from public.accounting_documents where id = r.id;
      paths := paths || r.storage_path;
    end loop;
    update public.email_attachments a set accounting_skip = v_note
      from public.emails e join public.email_threads t on t.id = e.thread_id
     where a.email_id = e.id and t.accounting_contact_id = c.id and a.accounting_document_id is null and e.accounting_filed_at is not null
       and coalesce(a.accounting_skip, '') <> v_note;
  else
    update public.emails e set accounting_filed_at = null
      from public.email_threads t
     where t.id = e.thread_id and t.accounting_contact_id = c.id and e.has_attachments
       and exists (select 1 from public.email_attachments a where a.email_id = e.id and a.accounting_document_id is null and a.accounting_skip is not null and a.accounting_skip not in ('picture', 'bulk mail', 'not a document', 'too big to keep (over 15 MB)'));
  end if;
  return paths;
end;
$$;
revoke execute on function public.accounting_apply_contact_filing(uuid) from public, anon;
grant execute on function public.accounting_apply_contact_filing(uuid) to authenticated, service_role;
