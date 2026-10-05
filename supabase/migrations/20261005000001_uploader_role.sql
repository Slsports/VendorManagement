-- =============================================================================
-- 0004 — Uploader role
-- Invoice-upload-only users (e.g. Marina staff). The role value is added here; the
-- tables it may write to (invoice uploads) and their policies arrive with the
-- vendor/invoice schema. Until then an uploader can sign in and see nothing.
-- =============================================================================
alter type public.user_role add value if not exists 'uploader';
