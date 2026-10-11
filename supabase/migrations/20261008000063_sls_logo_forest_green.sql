-- =============================================================================
-- 0084 — Shaver Lake Sports logo and forest green (Dana, Oct 10)
-- The new pin logo with the SLSI fish (public/brand/sls/) replaces the old fish
-- PNGs, and the accent moves from #00B050 to the logo's forest green #2F6B4F.
-- Only replaces the values set by 0005–0007, so a logo or color Dana has since
-- picked in Settings is left alone.
-- =============================================================================
update public.organizations
set logo_url = '/brand/sls/logo-mark.svg'
where id = '00000000-0000-0000-0000-000000000001'
  and logo_url = '/brand/slsi-logo.png';

update public.organizations
set logo_dark_url = '/brand/sls/logo-mark-dark.svg'
where id = '00000000-0000-0000-0000-000000000001'
  and logo_dark_url = '/brand/slsi-logo-white.png';

update public.organizations
set accent_color = '#2f6b4f'
where id = '00000000-0000-0000-0000-000000000001'
  and lower(accent_color) = '#00b050';
