-- 0365: a Sent order placed from an old reply is dated by the reply (ack_at and the history row), not by when VMS read it.
do $$
declare v_org uuid := '00000000-0000-0000-0000-000000000001'; v uuid; th uuid; o1 uuid; e_in uuid; r record;
begin
  insert into public.vendors (organization_id, name) values (v_org, 'SLIPPERY 0365') returning id into v;
  insert into public.email_threads (organization_id, gmail_thread_id, subject, last_message_at, vendor_id) values (v_org, 't0365', 'Missing items', now(), v) returning id into th;
  insert into public.orders (organization_id, vendor_id, status, po_number, source, order_date) values (v_org, v, 'open', 'SR0365', 'email', current_date - 300) returning id into o1;
  insert into public.emails (organization_id, thread_id, gmail_id, direction, from_email, to_emails, subject, received_at, body_text, vendor_id)
    values (v_org, th, 'm0365-2', 'in', 'marcy@slippery.example', '{orders@shaverlakesports.com}', 'RE: Missing items', now() - interval '299 days', 'Got it', v) returning id into e_in;
  perform public.order_ack_save(e_in, o1, true);
  select * into r from public.orders where id = o1;
  if r.status <> 'awaiting_confirmation' then raise exception 'not placed'; end if;
  if r.ack_at > now() - interval '298 days' then raise exception 'ack_at is today, not the reply''s day: %', r.ack_at; end if;
  if (select changed_at from public.order_status_history where order_id = o1 and to_status = 'awaiting_confirmation') > now() - interval '298 days' then raise exception 'history dated today'; end if;
  -- a person pressing the button today is dated today
  insert into public.orders (organization_id, vendor_id, status, po_number, source) values (v_org, v, 'open', 'SR0365B', 'email') returning id into o1;
  perform public.order_placed(o1, 'person', null);
  if (select ack_at from public.orders where id = o1) < now() - interval '1 minute' then raise exception 'button not dated now'; end if;
  raise exception 'ok-rollback';
exception when others then
  if sqlerrm <> 'ok-rollback' then raise; end if;
end $$;
