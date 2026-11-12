-- 0359: a Sent order becomes Placed from a reply Claude read, a filed confirmation or the button; no reply in 2 business
-- days makes the reminder for whoever sent it, which closes when the order moves on.
do $$
declare v_org uuid := '00000000-0000-0000-0000-000000000001'; v uuid; th uuid; o1 uuid; o2 uuid; e_out uuid; e_in uuid; r record; n int; me uuid := '11111111-1111-1111-1111-111111111111';
begin
  insert into public.vendors (organization_id, name) values (v_org, 'SLIPPERY 0359') returning id into v;
  insert into public.email_threads (organization_id, gmail_thread_id, subject, last_message_at, vendor_id) values (v_org, 't0359', 'Order', now(), v) returning id into th;
  insert into public.orders (organization_id, vendor_id, status, po_number, source, placed_by_id) values (v_org, v, 'open', 'SR0359', 'email', me) returning id into o1;
  insert into public.emails (organization_id, thread_id, gmail_id, direction, from_email, to_emails, subject, received_at, body_text, vendor_id, order_id)
    values (v_org, th, 'm0359-1', 'out', 'orders@shaverlakesports.com', '{marcy@slippery.example}', 'Order SR0359', now() - interval '6 days', 'Our order', v, o1) returning id into e_out;
  -- no reply after 2 business days: a reminder for whoever sent it
  n := public.order_noreply_reminders(v_org);
  select * into r from public.tasks where auto_key = 'noreply:' || o1;
  if r.id is null or r.assigned_to <> me or r.draft_id is null then raise exception 'no reminder for the sender'; end if;
  -- a reply arrives: it is a candidate; Claude says they got it → Placed, reminder closed, draft gone
  insert into public.emails (organization_id, thread_id, gmail_id, direction, from_email, to_emails, subject, received_at, body_text, vendor_id)
    values (v_org, th, 'm0359-2', 'in', 'marcy@slippery.example', '{orders@shaverlakesports.com}', 'Re: Order SR0359', now() - interval '1 hour', 'Got it, thanks!', v) returning id into e_in;
  if not exists (select 1 from public.order_ack_candidates(100) c where c.email_id = e_in and c.order_id = o1) then raise exception 'reply not a candidate'; end if;
  perform public.order_ack_save(e_in, o1, true);
  if (select status::text || '/' || ack_how || '/' || (ack_email_id = e_in)::text from public.orders where id = o1) <> 'awaiting_confirmation/reply/true' then raise exception 'not placed from the reply'; end if;
  if (select done_at from public.tasks where auto_key = 'noreply:' || o1) is null then raise exception 'reminder still open'; end if;
  if exists (select 1 from public.email_drafts where id = r.draft_id) then raise exception 'follow-up draft kept'; end if;
  if exists (select 1 from public.order_ack_candidates(100) c where c.email_id = e_in) then raise exception 'read twice'; end if;

  -- a confirmation filed on a Sent order makes it Placed
  insert into public.orders (organization_id, vendor_id, status, po_number, source) values (v_org, v, 'open', 'SR0359B', 'email') returning id into o2;
  insert into public.vendor_links (organization_id, vendor_id, kind, label, storage_path, order_id) values (v_org, v, 'confirmation', 'Conf', 'x/0359.pdf', o2);
  if (select status::text from public.orders where id = o2) <> 'awaiting_confirmation' then raise exception 'confirmation did not place it'; end if;
  raise exception 'ok-rollback';
exception when others then
  if sqlerrm <> 'ok-rollback' then raise; end if;
end $$;
