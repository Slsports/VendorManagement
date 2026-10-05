-- =============================================================================
-- 0009 — Vendor fields from Dana's contact sheets: freight program and product types
-- =============================================================================
alter table public.vendors
  add column if not exists freight_program text,
  add column if not exists product_types  text;

comment on column public.vendors.freight_program is 'Free-freight thresholds and shipping programs, e.g. "Free freight over $500".';
comment on column public.vendors.product_types is 'Free-text description of what the vendor supplies, until categories are synced from Lightspeed.';
