-- 0248: a rep group's conversations (theirs in, ours out to their people) and the queue of rep mail still to read.
do $$
declare v_org uuid := '00000000-0000-0000-0000-000000000001'; v_rep uuid; v_sender uuid; v_thread1 uuid; v_thread2 uuid; v_thread3 uuid; v_ids uuid[];
begin
  insert into public.rep_groups (organization_id, name, email) values (v_org, 'Test Reps 0248', 'main@testreps.example') returning id into v_rep;
  insert into public.rep_group_contacts (organization_id, rep_group_id, name, email) values (v_org, v_rep, 'Donna Test', 'donna@testreps.example');
  insert into public.email_senders (organization_id, sender_key, kind, rep_group_id) values (v_org, 'donna@testreps.example', 'rep_group', v_rep) returning id into v_sender;
  insert into public.email_threads (organization_id, gmail_thread_id, subject, last_message_at) values (v_org, 't0248-1', 'From Donna', now()) returning id into v_thread1;
  insert into public.email_threads (organization_id, gmail_thread_id, subject, last_message_at) values (v_org, 't0248-2', 'To Donna', now()) returning id into v_thread2;
  insert into public.email_threads (organization_id, gmail_thread_id, subject, last_message_at) values (v_org, 't0248-3', 'Unrelated', now()) returning id into v_thread3;
  insert into public.emails (organization_id, thread_id, gmail_id, direction, from_email, to_emails, subject, received_at, sender_id)
    values (v_org, v_thread1, 'm0248-1', 'in', 'donna@testreps.example', '{orders@example.com}', 'From Donna', now() - interval '200 days', v_sender),
           (v_org, v_thread2, 'm0248-2', 'out', 'orders@example.com', '{donna@testreps.example}', 'To Donna', now(), null),
           (v_org, v_thread3, 'm0248-3', 'in', 'someone@else.example', '{orders@example.com}', 'Unrelated', now(), null);
  v_ids := public.rep_group_thread_ids(v_org, v_rep);
  if not (v_thread1 = any (v_ids)) or not (v_thread2 = any (v_ids)) or (v_thread3 = any (v_ids)) then raise exception 'rep group threads wrong: %', v_ids; end if;
  if (select count(*) from public.mail_rep_queue(v_org, 50) q where q.id in (select id from public.emails where gmail_id like 'm0248-%')) <> 2 then raise exception 'rep queue should hold the two rep emails (old one included, our own included)'; end if;
  delete from public.email_threads where gmail_thread_id like 't0248-%';
  delete from public.email_senders where id = v_sender;
  delete from public.rep_groups where id = v_rep;
end $$;
