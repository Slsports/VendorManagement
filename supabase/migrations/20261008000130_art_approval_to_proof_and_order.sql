-- 130: an artwork approval reaches the proof and the order (Dana, Oct 16, "go"). When a conversation's artwork is
-- approved (Dana's "approved" reply from orders@ in Gmail or VMS, read by Claude, or the Approved button), the proofs
-- filed from that conversation get the Approved star, and the order the conversation is filed to shows "Artwork approved"
-- with the date.

alter table public.orders add column if not exists art_approved_at timestamptz;
comment on column public.orders.art_approved_at is 'When the artwork for this order was approved (from the approval email or button).';

create or replace function public.thread_art_approved()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_when timestamptz;
begin
  if new.art_status is distinct from 'approved' or old.art_status is not distinct from 'approved' then return new; end if;
  -- when: our newest reply in the conversation, else now
  select max(received_at) into v_when from public.emails where thread_id = new.id and direction = 'out';
  v_when := coalesce(v_when, now());
  -- the proofs filed from this conversation (not ones Dana already set by hand)
  update public.vendor_links set kind = 'approved_proof', approved_at = v_when, approved_by = null
   where kind = 'proof' and email_id in (select id from public.emails where thread_id = new.id);
  -- the order: one the conversation's emails or its proofs are filed to
  update public.orders set art_approved_at = v_when
   where art_approved_at is null and id in (
     select order_id from public.emails where thread_id = new.id and order_id is not null
     union select order_id from public.vendor_links where order_id is not null and email_id in (select id from public.emails where thread_id = new.id)
     union select order_id from public.order_checks where order_id is not null and email_id in (select id from public.emails where thread_id = new.id));
  return new;
end;
$$;
drop trigger if exists email_threads_art_approved on public.email_threads;
create trigger email_threads_art_approved after update of art_status on public.email_threads
  for each row execute function public.thread_art_approved();

-- back-check: conversations already approved
do $$
declare t record;
begin
  for t in select id from public.email_threads where art_status = 'approved' loop
    update public.vendor_links set kind = 'approved_proof',
           approved_at = coalesce((select max(received_at) from public.emails where thread_id = t.id and direction = 'out'), now())
     where kind = 'proof' and email_id in (select id from public.emails where thread_id = t.id);
    update public.orders set art_approved_at = coalesce((select max(received_at) from public.emails where thread_id = t.id and direction = 'out'), now())
     where art_approved_at is null and id in (
       select order_id from public.emails where thread_id = t.id and order_id is not null
       union select order_id from public.vendor_links where order_id is not null and email_id in (select id from public.emails where thread_id = t.id)
       union select order_id from public.order_checks where order_id is not null and email_id in (select id from public.emails where thread_id = t.id));
  end loop;
end $$;
