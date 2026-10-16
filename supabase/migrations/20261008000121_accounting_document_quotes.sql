-- 0121 — A quote (an insurance quote, a proposal) is its own kind of paper; the first run met one in a Hub email.
alter table public.accounting_documents drop constraint if exists accounting_documents_kind_check;
alter table public.accounting_documents add constraint accounting_documents_kind_check
  check (kind in ('invoice', 'receipt', 'statement', 'policy', 'certificate', 'license', 'contract', 'quote', 'letter', 'form', 'tax_return', 'notice', 'report', 'check', 'other'));
