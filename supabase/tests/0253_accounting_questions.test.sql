-- 0253: question and choices on a paper under review; answering by changing the facts renames the file by the rule.
do $$
declare v_org uuid := '00000000-0000-0000-0000-000000000001'; v_id uuid;
begin
  insert into public.accounting_documents (organization_id, category, party, doc_year, file_name, kind, whose, doc_date, number, what, amount, status_word, storage_path, sha256, status, sure, claude_note, question, choices)
    values (v_org, 'contracts', 'SCE Licensing', 2026, '2025-12-02 GS SCE Licensing 7701290549 Operating Rent $51426.75 due.pdf', 'invoice', 'GS', '2025-12-02', '7701290549', 'Operating Rent', 51426.75, 'due', 'x/0253.pdf', 'sha0253', 'review', false, 'license 9.4763 is the marina license',
      'Whose license is this rent for?', '[{"label":"GS","whose":"GS","party":"","category":"","what":""},{"label":"SLM","whose":"SLM","party":"","category":"","what":""}]'::jsonb)
    returning id into v_id;
  if (select jsonb_array_length(choices) from public.accounting_documents where id = v_id) <> 2 then raise exception 'choices not stored'; end if;
  update public.accounting_documents set whose = 'SLM', status = 'filed', sure = true, question = '', choices = '[]'::jsonb where id = v_id;
  if (select file_name from public.accounting_documents where id = v_id) <> '2025-12-02 SLM SCE Licensing 7701290549 Operating Rent $51426.75 due.pdf' then
    raise exception 'answer did not rename: %', (select file_name from public.accounting_documents where id = v_id); end if;
  if (select question from public.accounting_documents where id = v_id) <> '' then raise exception 'question not cleared'; end if;
  delete from public.accounting_documents where id = v_id;
end $$;
