-- 0122 — Some senders' papers are handled elsewhere (Dana, Oct 16: Emery Jensen invoices auto-forward to bill.com, she pays
-- through the EJ portal by ACH and bill.com syncs to QBO). A contact can say "leave their papers in the email", with a
-- note; the filing step skips them with that note, and the change re-checks the old: papers already filed from that
-- contact's conversations are taken back out, or emails skipped for that reason are looked at again.
alter table public.accounting_contacts add column if not exists filing text not null default 'file' check (filing in ('file', 'skip'));
alter table public.accounting_contacts add column if not exists filing_note text not null default '';
comment on column public.accounting_contacts.filing is 'file: their papers go into the Accounting folders; skip: left in the email with filing_note as the reason (handled in bill.com).';

create or replace function public.accounting_apply_contact_filing(p_contact uuid) returns integer
language plpgsql security definer set search_path = public as $$
declare c public.accounting_contacts%rowtype; n integer := 0; v_note text; r record;
begin
  if auth.uid() is not null and not public.sees_accounting() then raise exception 'Accounting only' using errcode = '42501'; end if;
  select * into c from public.accounting_contacts where id = p_contact;
  if not found then return 0; end if;
  v_note := coalesce(nullif(trim(c.filing_note), ''), 'handled elsewhere');
  if c.filing = 'skip' then
    -- papers already filed from their conversations come back out (the email keeps its attachment)
    for r in
      select d.id, d.storage_path from public.accounting_documents d
        join public.emails e on e.id = d.email_id
        join public.email_threads t on t.id = e.thread_id
       where d.organization_id = c.organization_id and t.accounting_contact_id = c.id
    loop
      update public.email_attachments set accounting_document_id = null, accounting_skip = v_note where accounting_document_id = r.id;
      delete from storage.objects where bucket_id = 'accounting-files' and name = r.storage_path;
      delete from public.accounting_documents where id = r.id;
      n := n + 1;
    end loop;
    -- files not looked at yet, or skipped for another reason, carry the note so the conversation says why
    update public.email_attachments a set accounting_skip = v_note
      from public.emails e join public.email_threads t on t.id = e.thread_id
     where a.email_id = e.id and t.accounting_contact_id = c.id and a.accounting_document_id is null and e.accounting_filed_at is not null
       and coalesce(a.accounting_skip, '') <> v_note;
  else
    -- back to filing: their emails are looked at again
    update public.emails e set accounting_filed_at = null
      from public.email_threads t
     where t.id = e.thread_id and t.accounting_contact_id = c.id and e.has_attachments
       and exists (select 1 from public.email_attachments a where a.email_id = e.id and a.accounting_document_id is null and a.accounting_skip is not null and a.accounting_skip not in ('picture', 'bulk mail', 'not a document', 'too big to keep (over 15 MB)'));
    get diagnostics n = row_count;
  end if;
  return n;
end;
$$;
revoke execute on function public.accounting_apply_contact_filing(uuid) from public, anon;
grant execute on function public.accounting_apply_contact_filing(uuid) to authenticated, service_role;
