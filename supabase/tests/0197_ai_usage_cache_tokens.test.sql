-- 0197: ai_usage keeps cache read and write tokens, defaulting to 0 for rows the client does not fill.
do $$
declare v_org uuid; v_id uuid;
begin
  insert into public.organizations (name, slug) values ('Cache test org', 'cache-test') returning id into v_org;
  insert into public.ai_usage (organization_id, purpose, model, input_tokens, output_tokens)
    values (v_org, 'mail_sort', 'claude-haiku-5-5', 100, 10) returning id into v_id;
  if (select cache_read_tokens from public.ai_usage where id = v_id) <> 0 then raise exception 'cache_read_tokens should default to 0'; end if;
  update public.ai_usage set cache_read_tokens = 80, cache_write_tokens = 20 where id = v_id;
  if (select cache_read_tokens + cache_write_tokens from public.ai_usage where id = v_id) <> 100 then raise exception 'cache tokens not kept'; end if;
  delete from public.organizations where id = v_org;
end $$;
