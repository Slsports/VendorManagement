-- 0206 — A proof or credit task takes you to it (Dana, Oct 20: "When I click on one it does nothing … if I click on the
-- email nothing opens"). Go to it now opens the file itself (app), and the task carries the email the file came in on,
-- so the task box shows "Email: …" and opens it. Only Orders mail is put on a task (a task is seen by everyone; a file
-- from someone's own inbox keeps its email private).
-- Back-check: every open proof and credit task, for every vendor, gets its email and the new note.

create or replace function public.document_thread(p_link public.vendor_links) returns uuid
language sql stable security definer set search_path = public as $$
  select e.thread_id from public.emails e join public.email_threads t on t.id = e.thread_id
   where e.id = p_link.email_id and (t.mailbox_id is null or t.shared_at is not null)
$$;
revoke execute on function public.document_thread(public.vendor_links) from public, anon;
grant execute on function public.document_thread(public.vendor_links) to authenticated, service_role;

create or replace function public.vendor_links_next_step() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  vn   text;
  who  uuid;
  st   public.order_status;
begin
  if tg_op = 'DELETE' then
    delete from public.tasks where organization_id = old.organization_id and done_at is null and auto_key in ('proof:' || old.id, 'credit:' || old.id);
    return old;
  end if;
  select name into vn from public.vendors where id = new.vendor_id;
  vn := coalesce(vn, 'the vendor');

  -- a proof to approve (only when it lands as a proof; a proof moved elsewhere drops its task)
  if new.kind = 'proof' and (tg_op = 'INSERT' or old.kind is distinct from 'proof') then
    who := public.document_owner(new);
    if who is not null then
      insert into public.tasks (organization_id, title, notes, due_date, assigned_to, vendor_id, order_id, thread_id, auto_key)
      values (new.organization_id, format('Approve the proof from %s: %s', vn, public.document_title(new)),
              'Click Go to it to open the proof. Once the vendor has our OK, click Mark approved on the proof and this task finishes itself.',
              current_date + 3, who, new.vendor_id, new.order_id, public.document_thread(new), 'proof:' || new.id)
      on conflict (organization_id, auto_key) where auto_key is not null do update
        set title = excluded.title, thread_id = coalesce(public.tasks.thread_id, excluded.thread_id), assigned_to = case when public.tasks.done_at is null then public.tasks.assigned_to else excluded.assigned_to end,
            done_at = null, done_by = null, done_note = null;
    end if;
  elsif tg_op = 'UPDATE' and old.kind = 'proof' and new.kind <> 'proof' then
    if new.kind = 'approved_proof' then
      update public.tasks set done_at = now(), done_by = coalesce(new.approved_by, auth.uid()), done_note = 'Approved'
       where organization_id = new.organization_id and auto_key = 'proof:' || new.id and done_at is null;
    else
      delete from public.tasks where organization_id = new.organization_id and auto_key = 'proof:' || new.id and done_at is null;
    end if;
  end if;

  -- a credit for Accounting
  if new.kind = 'credit' and (tg_op = 'INSERT' or old.kind is distinct from 'credit') then
    who := public.org_admin(new.organization_id);
    if who is not null then
      insert into public.tasks (organization_id, title, notes, due_date, assigned_to, vendor_id, order_id, thread_id, auto_key, area)
      values (new.organization_id, format('Credit from %s: %s', vn, public.document_title(new)),
              'Click Go to it to open the credit. Check it against the invoice it credits and apply it to the next payment to this vendor.',
              current_date + 7, who, new.vendor_id, new.order_id, public.document_thread(new), 'credit:' || new.id, 'accounting')
      on conflict (organization_id, auto_key) where auto_key is not null do nothing;
    end if;
  elsif tg_op = 'UPDATE' and old.kind = 'credit' and new.kind <> 'credit' then
    delete from public.tasks where organization_id = new.organization_id and auto_key = 'credit:' || new.id and done_at is null;
  end if;

  -- a packing slip: the order is on its way
  if new.kind = 'packing_slip' and new.order_id is not null and (tg_op = 'INSERT' or old.kind is distinct from 'packing_slip' or old.order_id is distinct from new.order_id) then
    select status into st from public.orders where id = new.order_id;
    if st in ('open', 'awaiting_confirmation', 'confirmed') then
      update public.orders set status = 'shipped' where id = new.order_id;
    end if;
  end if;
  return new;
end;
$$;

-- back-check
do $$
declare n_mail int; n_note int;
begin
  update public.tasks t set thread_id = public.document_thread(l)
    from public.vendor_links l
   where t.done_at is null and t.thread_id is null and t.auto_key in ('proof:' || l.id, 'credit:' || l.id)
     and public.document_thread(l) is not null;
  get diagnostics n_mail = row_count;
  update public.tasks set notes = case when auto_key like 'proof:%'
      then 'Click Go to it to open the proof. Once the vendor has our OK, click Mark approved on the proof and this task finishes itself.'
      else 'Click Go to it to open the credit. Check it against the invoice it credits and apply it to the next payment to this vendor.' end
   where done_at is null and (auto_key like 'proof:%' or auto_key like 'credit:%')
     and notes in ('Open the vendor''s Proofs folder and look at it. Once the vendor has our OK, click Mark approved on the proof and this task finishes itself.',
                   'Check it against the invoice it credits and apply it to the next payment to this vendor. The credit is in the vendor''s Credits folder.');
  get diagnostics n_note = row_count;
  raise notice 'back-check: % open proof/credit tasks got their email, % notes updated', n_mail, n_note;
end $$;
