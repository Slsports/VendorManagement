-- 0257: a credit dated before the request never answers it; one dated after it does.
do $$
declare v_org uuid := '00000000-0000-0000-0000-000000000001'; v_vendor uuid; v_thread uuid; v_email uuid; v_req uuid; v_old uuid; v_new uuid;
begin
  update public.profiles set is_active = true where id = '33333333-3333-3333-3333-333333333333';
  insert into public.vendors (organization_id, name) values (v_org, 'TEST CREDIT VENDOR 0257') returning id into v_vendor;
  insert into public.email_threads (organization_id, gmail_thread_id, subject, last_message_at, vendor_id) values (v_org, 't0257', 'Short shipment', now(), v_vendor) returning id into v_thread;
  insert into public.emails (organization_id, thread_id, gmail_id, direction, from_email, to_emails, subject, received_at, body_text, vendor_id)
    values (v_org, v_thread, 'm0257-1', 'out', 'orders@example.com', '{rep@vendor.example}', 'Short shipment', now() - interval '2 days', 'Please credit $25. Trevor', v_vendor) returning id into v_email;
  v_req := public.credit_request_make(v_email, 'short shipment', null, 25, 'Trevor');
  -- an old credit for the same amount, dated months before the request (loaded today): not the answer
  insert into public.vendor_links (organization_id, vendor_id, kind, label, storage_path, file_name, received_at, doc_date, doc_number, doc_total, source)
    values (v_org, v_vendor, 'credit', 'Credit OLD', 'x/0257a.pdf', 'old.pdf', current_date, current_date - 120, 'OLD1', 25, 'email') returning id into v_old;
  if (select status from public.credit_requests where id = v_req) <> 'open' then raise exception 'old credit matched the request'; end if;
  -- a credit dated after the request for the same amount: Received
  insert into public.vendor_links (organization_id, vendor_id, kind, label, storage_path, file_name, received_at, doc_date, doc_number, doc_total, source)
    values (v_org, v_vendor, 'credit', 'Credit NEW', 'x/0257b.pdf', 'new.pdf', current_date, current_date, 'NEW1', 25, 'email') returning id into v_new;
  if (select status from public.credit_requests where id = v_req) <> 'received' or (select credit_link_id from public.credit_requests where id = v_req) <> v_new then raise exception 'new credit did not match'; end if;
  delete from public.credit_requests where vendor_id = v_vendor;
  delete from public.tasks where vendor_id = v_vendor;
  delete from public.vendor_links where vendor_id = v_vendor;
  delete from public.emails where thread_id = v_thread;
  delete from public.email_threads where id = v_thread;
  delete from public.vendors where id = v_vendor;
end $$;
