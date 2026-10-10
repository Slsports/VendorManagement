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
| `<edition>/logo-horizontal.svg` / `-dark.svg` | App header and sidebar, email headers |
| `<edition>/logo-stacked.svg` / `-dark.svg` | Login screen, report covers, print |
| `*.png` versions of the logos | Places that can't render SVG (email bodies, Excel title rows, PDFs) |
| `<edition>/site.webmanifest` | PWA manifest pointing at that edition's icons |

Use `-dark` variants on dark backgrounds. On dark backgrounds the pin sits on an amber glow. On light backgrounds it has an amber-edged shadow with a green core.

All SVGs are self-contained: the text is converted to outlines and the fish is vector, so no fonts are required.

## Palette

| Token | Hex | Use |
|---|---|---|
| Forest green (light) | `#2F6B4F` | Tile and inset gradient start |
| Forest green (deep) | `#143726` | Gradient end, manifest background |
| Forest green (ink) | `#1E4A35` | Text on light backgrounds, V cutout, theme color |
| Amber (light) | `#F4C578` | Pin gradient top, glow |
| Amber (deep) | `#C7852F` | Pin gradient bottom, shadow edge |
| Amber text | `#B07A34` (light bg) / `#E9AE5A` (dark bg) | Subtitles |
| Cream | `#F5EEDF` | Fish, text on dark backgrounds |

There is no gray in the palette. Shadows are amber and green.

## Wiring into the app

`index.html`:

```html
<link rel="icon" href="/brand/favicon.ico" sizes="48x48" />
<link rel="icon" type="image/svg+xml" href="/brand/favicon.svg" />
<link rel="apple-touch-icon" href="/brand/sls/apple-touch-icon.png" />
<link rel="manifest" href="/brand/sls/site.webmanifest" />
<meta name="theme-color" content="#1E4A35" />
```

`src/lib/theme.ts` defaults for organization #1:

```ts
logoUrl: '/brand/sls/logo-horizontal.svg',
logoOnDarkUrl: '/brand/sls/logo-horizontal-dark.svg',
```

For the white-label build, swap `sls` for `vms` (or set `VITE_LOGO_URL` / `VITE_LOGO_DARK_URL`).
