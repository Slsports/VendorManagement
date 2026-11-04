-- 0306 — Text alerts by category (Dana, Nov 4: "I would like to be able to tell the system what types of alerts I want to my
--   texts. Can we have categories of things so I can just get them for my most important tasks?" — "go with your suggested
--   picks"). Each person picks categories in Settings (profiles.text_categories; empty = every category, as before); a task's
--   own Text me switch wins (tasks.text_me: true always, false never, null = the person's categories). The categories and
--   which task kinds fall in them: supabase/functions/_shared/textAlerts.ts. Dashboard and email reminders are unchanged.
set local lock_timeout = '5s';

alter table public.profiles add column if not exists text_categories text[] not null default '{}';
comment on column public.profiles.text_categories is 'Which kinds of reminders come by text (textAlerts.ts keys); empty = all (0306).';
alter table public.tasks add column if not exists text_me boolean;
comment on column public.tasks.text_me is 'Text me about this task: true always, false never, null = the person''s text categories (0306).';

-- Dana's picks: price lists and catalogs, payments due and discounts, insurance and contracts, questions waiting on her
update public.profiles set text_categories = array['price_lists', 'payments', 'insurance', 'questions']
 where full_name = 'Dana Powell' and role = 'admin' and text_categories = '{}';
