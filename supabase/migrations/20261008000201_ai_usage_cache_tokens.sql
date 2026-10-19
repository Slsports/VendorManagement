-- Claude's prompt cache (Dana, Oct 19: Anthropic wrote that VMS's cache hit rate is low). Every call's fixed
-- instructions are now marked cacheable; the log keeps how much of each call was read from the cache (a tenth of
-- the price) and how much was written to it (1.25x), so Settings can show whether the cache is doing its job.
alter table public.ai_usage add column if not exists cache_read_tokens integer not null default 0;
alter table public.ai_usage add column if not exists cache_write_tokens integer not null default 0;
comment on column public.ai_usage.cache_read_tokens is 'Input tokens Anthropic read from its prompt cache (billed at 0.1x); included in input_tokens.';
comment on column public.ai_usage.cache_write_tokens is 'Input tokens written to the prompt cache (billed at 1.25x); included in input_tokens.';
