-- 0254 — Credits: filed and marked Received, no Accounting task (Dana, Oct 27): "I assume these all just need to be filed
-- under the vendor name … The system should just mark the credit as received and filed it. Then if we have a question
-- about it we go to the vendor and we can see if we got the credit." And: "assign the 5 recent ones to Trevor. He is the
-- one that receives inventory, emails vendors when there is damage or shortages and he will track the credits too."
--
--   • vendor_links.credit_received_on: a credit is Received the day it came in (shown on the paper in Credits).
--   • No more "Credit from …" tasks. 31 of the 37 open ones came from Edenred's "Emailed invoices" mail of Oct 19-21:
--     the credits are dated Sep 2025 to Aug 2026, but the 30-day rule went by the email's date. Closed at Dana's request.
--   • The 5 recent ones (World Famous, Daisy, Emery Jensen, Stansport, Luhr Jensen) go to Trevor, out of Accounting.
--   • "SAA Credit Card Application" is a credit card application form, not a credit: moved to Other.
--   (Credit requests with a 7-day reminder and the Edenred check are Fable's build.)

set local lock_timeout = '5s';

alter table public.vendor_links add column if not exists credit_received_on date;
comment on column public.vendor_links.credit_received_on is 'A credit is Received: the day it came in (Dana, Oct 27).';

create or replace function public.vendor_links_credit_received() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.kind = 'credit' then
    new.credit_received_on := coalesce(new.credit_received_on, new.received_at, new.doc_date, current_date);
  else
    new.credit_received_on := null;
  end if;
  return new;
end;
$$;
revoke execute on function public.vendor_links_credit_received() from public, anon, authenticated;
drop trigger if exists vendor_links_credit_received on public.vendor_links;
create trigger vendor_links_credit_received before insert or update of kind on public.vendor_links for each row execute function public.vendor_links_credit_received();

create or replace function public.vendor_links_next_step()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  vn   text;
  who  uuid;
  st   public.order_status;
  ap   public.emails%rowtype;
  said text;
begin
  if tg_op = 'DELETE' then
    delete from public.tasks where organization_id = old.organization_id and done_at is null and auto_key in ('proof:' || old.id, 'credit:' || old.id);
    return old;
  end if;
  select name into vn from public.vendors where id = new.vendor_id;
  vn := coalesce(vn, 'the vendor');

  -- a proof to approve (only when it lands as a proof; a proof moved elsewhere drops its task); it reminds right away
  if new.kind = 'proof' and (tg_op = 'INSERT' or old.kind is distinct from 'proof') and coalesce(new.received_at, current_date) >= current_date - 30 then
    who := public.document_owner(new);
    if who is not null then
      insert into public.tasks (organization_id, title, notes, due_date, remind_at, assigned_to, vendor_id, order_id, thread_id, auto_key)
      values (new.organization_id, format('Approve the proof from %s: %s', vn, public.document_title(new)),
              'Click Go to it to open the proof. Once the vendor has our OK, click Mark approved on the proof and this task finishes itself.',
              current_date + 3, now(), who, new.vendor_id, new.order_id, public.document_thread(new), 'proof:' || new.id)
      on conflict (organization_id, auto_key) where auto_key is not null do update
        set title = excluded.title, thread_id = coalesce(public.tasks.thread_id, excluded.thread_id), assigned_to = case when public.tasks.done_at is null then public.tasks.assigned_to else excluded.assigned_to end,
            remind_at = case when public.tasks.done_at is null then coalesce(public.tasks.remind_at, now()) else now() end, reminded_at = case when public.tasks.done_at is null then public.tasks.reminded_at end,
            done_at = null, done_by = null, done_note = null, done_email_id = null;
    end if;
  elsif tg_op = 'UPDATE' and old.kind = 'proof' and new.kind <> 'proof' then
    if new.kind = 'approved_proof' then
      -- approved by our reply (Claude read it): the reply, its date and words on the task
      if new.approved_by is null then
        select e.* into ap from public.emails e
         where e.id = (select art_approved_email_id from public.email_threads where id = public.document_thread(new));
        if ap.id is null then
          select e.* into ap from public.emails e
           where e.thread_id = public.document_thread(new) and e.direction = 'out' and e.received_at <= coalesce(new.approved_at, now())
           order by e.received_at desc limit 1;
        end if;
        said := nullif(left(trim(regexp_replace(split_part(split_part(coalesce(ap.body_text, ap.snippet, ''), E'\nOn ', 1), E'\n>', 1), '\s+', ' ', 'g')), 140), '');
      end if;
      update public.tasks set done_at = now(), done_by = coalesce(new.approved_by, auth.uid()),
             done_note = case when ap.id is not null then format('Approved by your reply on %s%s', to_char(ap.received_at at time zone 'America/Los_Angeles', 'Mon FMDD, YYYY'), coalesce(': "' || said || '"', ''))
                              else 'Approved' end,
             done_email_id = ap.id
       where organization_id = new.organization_id and auto_key = 'proof:' || new.id and done_at is null;
    else
      delete from public.tasks where organization_id = new.organization_id and auto_key = 'proof:' || new.id and done_at is null;
    end if;
  end if;

  -- a credit: filed and marked Received, no task (Dana, Oct 27); one moved out of Credits drops any open credit task
  if tg_op = 'UPDATE' and old.kind = 'credit' and new.kind <> 'credit' then
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
$function$;

-- every credit on file is Received
update public.vendor_links set credit_received_on = coalesce(received_at, doc_date, created_at::date) where kind = 'credit' and credit_received_on is null;

-- the SAA credit card application is not a credit (its open task goes with it)
update public.vendor_links l set kind = 'other'
  from public.vendors v
 where v.id = l.vendor_id and v.name = 'SAA' and l.kind = 'credit' and l.label ilike '%credit card application%';

-- the 5 recent credits: Trevor's, out of Accounting
update public.tasks t set assigned_to = p.id, area = 'general',
       notes = 'Trevor tracks credits (Dana, Oct 27). The credit came in and is filed in the vendor''s Credits folder, marked Received. '
               || case when exists (select 1 from public.vendor_billing_routes r where r.vendor_id = t.vendor_id and r.route = 'worldwide')
                       then 'It is a WWD vendor: check that the credit shows on Edenred, then mark this done.'
                       else 'Not a WWD vendor: check it, then mark this done.' end
  from public.vendor_links l, public.profiles p
 where t.auto_key = 'credit:' || l.id and t.done_at is null
   and coalesce(l.received_at, l.created_at::date) < date '2026-10-19'
   and p.organization_id = t.organization_id and p.email = 'trevor@shaverlakesports.com';

-- the rest: old credits, closed at Dana's request
update public.tasks t set done_at = now(), closed_how = 'request',
       done_note = 'Old credit (dated ' || coalesce(to_char(l.doc_date, 'Mon FMDD, YYYY'), 'before Oct 2026') || '), filed in the vendor''s Credits folder and marked Received. Dana, Oct 27: credits are filed, not tasks.'
  from public.vendor_links l
 where t.auto_key = 'credit:' || l.id and t.done_at is null and t.area = 'accounting';
