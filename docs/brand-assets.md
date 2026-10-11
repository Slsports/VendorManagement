# VMS Brand Assets

All files live in `public/brand/` and are served from `/brand/...`.

There are two editions:

- **`sls/`**: Shaver Lake Sports (organization #1). The pin holds the SLSI fish.
- **`vms/`**: the white-label edition for other tenants and RetailHQ. The pin holds "VMS".

Both editions use the same favicon: the amber pin with a V on the green tile.

## Files

| File | Use |
|---|---|
| `favicon.svg`, `favicon.ico` (16/32/48) | Browser tab icon (both editions) |
| `<edition>/app-icon.svg` | Master app icon (rounded tile) |
| `<edition>/icon-192.png`, `icon-512.png` | PWA / Android icons |
| `<edition>/icon-maskable-512.png`, `app-icon-maskable.svg` | Android adaptive icon (artwork kept inside the 80% safe zone) |
| `<edition>/apple-touch-icon.png` | iOS home screen (180×180, full-bleed) |
| `<edition>/logo-mark.svg` / `-dark.svg` | Pin only: sidebar and sign-in screen, where the app name sits beside it |
| `<edition>/logo-horizontal.svg` / `-dark.svg` | Email headers, report title rows, anywhere the name isn't already shown |
| `<edition>/logo-stacked.svg` / `-dark.svg` | Login screen, report covers, print |
| `*.png` versions of the logos | Places that can't render SVG (email bodies, Excel title rows, PDFs) |
| `<edition>/site.webmanifest` | PWA manifest pointing at that edition's icons |

Use `-dark` variants on dark backgrounds. On dark backgrounds the pin sits on an amber glow. On light backgrounds it has an amber-edged shadow with a green core.

All SVGs are self-contained: the text is converted to outlines and the fish is vector, so no fonts are required.

## Palette

| Token | Hex | Use |
|---|---|---|
| Forest green (light) | `#2F6B4F` | Tile and inset gradient start; app accent and theme color |
| Forest green (deep) | `#143726` | Gradient end, manifest background |
| Forest green (ink) | `#1E4A35` | Text on light backgrounds, V cutout |
| Amber (light) | `#F4C578` | Pin gradient top, glow |
| Amber (deep) | `#C7852F` | Pin gradient bottom, shadow edge |
| Amber text | `#B07A34` (light bg) / `#E9AE5A` (dark bg) | Subtitles |
| Cream | `#F5EEDF` | Fish, text on dark backgrounds |

There is no gray in the palette. Shadows are amber and green.

## How the app uses them

- `index.html` links `/brand/favicon.ico`, `/brand/favicon.svg`, the SLS apple-touch icon and manifest, and sets
  `theme-color` to `#2F6B4F`.
- `src/lib/theme.ts` defaults to `/brand/sls/logo-mark.svg` and `/brand/sls/logo-mark-dark.svg` with accent
  `#2F6B4F` (matching `:root` in `src/index.css`). Migration 0084 sets the same on organization #1.
- For a white-label tenant, point its `logo_url` / `logo_dark_url` at the `vms/` files (or its own upload), or set
  `VITE_LOGO_URL` / `VITE_LOGO_DARK_URL`.

The app accent (`#2F6B4F`) is the logo's lighter forest green; `#1E4A35` stays the ink color inside the artwork.
