-- 0253: a paper Claude was not sure about carries a plain question with the answers as buttons (Dana, Oct 27:
-- "This is not clear what I am saying 'Looks Right' to"). choices = [{label, whose, party, category, what}], '' = unchanged.
alter table public.accounting_documents
  add column if not exists question text not null default '',
  add column if not exists choices jsonb not null default '[]'::jsonb,
  add column if not exists question_asked_at timestamptz;   -- the back-check looked at this paper's note (once)
comment on column public.accounting_documents.question is 'When status = review: the one question for the owner, plain words; empty when the doubt is not a choice.';
comment on column public.accounting_documents.choices is 'The answers as buttons: [{label, whose, party, category, what}]; an empty field keeps what is filed. Cleared when answered.';
