-- 0257 — A credit answers a request only when the credit itself is dated after the request (Dana, Oct 27 build, first
-- back-check): old Edenred credits loaded on Oct 20-21 carry that day as Received but are dated months earlier, and
-- matched by amount or number against requests from September. The credit's own date (doc_date, else its Edenred posting
-- date, else the day it came in) must be on or after the request.

set local lock_timeout = '5s';

create or replace function public.credit_requests_match_link() returns trigger language plpgsql security definer set search_path = public as $$
declare v_req uuid; v_thread uuid; v_on date; v_dated date; w record;
begin
  if new.kind <> 'credit' or new.vendor_id is null then return null; end if;
  if tg_op = 'UPDATE' and old.kind = 'credit' and old.doc_number is not distinct from new.doc_number and old.doc_total is not distinct from new.doc_total then return null; end if;
  v_thread := public.document_thread(new);
  v_on := coalesce(new.credit_received_on, new.received_at, current_date);
  v_dated := coalesce(new.doc_date, new.on_edenred_on, v_on);
  select id into v_req from public.credit_requests r
   where r.vendor_id = new.vendor_id and r.status = 'open' and r.requested_on <= v_dated
     and ((v_thread is not null and r.thread_id = v_thread)
       or (r.invoice_number is not null and public.vin_norm(r.invoice_number) = public.vin_norm(new.doc_number))
       or (r.amount is not null and new.doc_total is not null and abs(new.doc_total) = r.amount))
   order by (v_thread is not null and r.thread_id = v_thread) desc,
            (r.invoice_number is not null and public.vin_norm(r.invoice_number) = public.vin_norm(new.doc_number)) desc, r.requested_on desc
   limit 1;
  if v_req is not null then perform public.credit_request_received(v_req, new.id, v_on); end if;
  select i.id, i.posted_date, i.wwd_date into w from public.wwd_invoices i
   where i.vendor_id = new.vendor_id and i.kind = 'credit' and 'edenred' = any (i.sources)
     and (i.document_id = new.id
       or (new.doc_number is not null and public.vin_norm(i.vendor_invoice_number) = public.vin_norm(new.doc_number))
       or (new.doc_total is not null and i.amount is not null and abs(i.amount) = abs(new.doc_total)))
   order by (i.document_id = new.id) desc, i.posted_date desc nulls last limit 1;
  if w.id is not null then perform public.credit_on_edenred(new.id, w.id, coalesce(w.posted_date, w.wwd_date, current_date)); end if;
  return null;
end $$;

create or replace function public.credit_on_edenred(p_link uuid, p_wwd uuid, p_on date) returns void language plpgsql security definer set search_path = public as $$
declare r public.credit_requests%rowtype; v_vn text; w public.wwd_invoices%rowtype;
begin
  select * into w from public.wwd_invoices where id = p_wwd;
  update public.vendor_links set on_edenred_on = coalesce(on_edenred_on, p_on) where id = p_link and kind = 'credit';
  for r in select * from public.credit_requests where status in ('open', 'received')
            and (credit_link_id = p_link or (vendor_id = w.vendor_id and credit_link_id is null and requested_on <= p_on and (
                   (invoice_number is not null and public.vin_norm(invoice_number) = public.vin_norm(w.vendor_invoice_number))
                or (amount is not null and w.amount is not null and abs(w.amount) = amount)))) loop
    select name into v_vn from public.vendors where id = r.vendor_id;
    update public.credit_requests set status = 'on_edenred', wwd_invoice_id = p_wwd, on_edenred_on = p_on,
           credit_link_id = coalesce(credit_link_id, p_link), received_on = coalesce(received_on, p_on) where id = r.id;
    update public.tasks set done_at = now(), closed_how = 'vms', remind_at = null, remind_rule = null,
           done_note = 'The credit from ' || coalesce(v_vn, 'the vendor') || ' is on Edenred (posted ' || to_char(p_on, 'Mon FMDD, YYYY') || ', WWD Seq # ' || w.seq
                       || case when w.vendor_invoice_number is not null then ', credit ' || w.vendor_invoice_number else '' end
                       || '). VMS saw it in the Edenred upload; the paper in the vendor''s Credits folder is tagged On Edenred.'
     where id = r.task_id and done_at is null;
    delete from public.email_drafts where id = (select draft_id from public.tasks where id = r.task_id) and gmail_draft_id is null;
  end loop;
end $$;
