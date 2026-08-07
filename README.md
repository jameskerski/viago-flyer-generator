# Recognition Flyer Tool

Own-built replacement for Snapp (app.getsnapp.ai/viago). Leaders pick a template,
drop in a photo, type a name, and download a post or story flyer.

Live: https://viago-flyers.pages.dev

## How it works

One canvas, three layers, rendered at full export resolution so the preview is
literally the file you download:

1. `bg` — background art (JPEG, opaque)
2. person cutout (transparent PNG)
3. `fg` — foreground art (PNG with alpha: scrims, rules, corner marks) + live text

Text is positioned in fractions of canvas width/height, so a single template
definition serves both 4:5 and 9:16 without a second layout.

```
public/
  index.html  styles.css  app.js
  templates.json      template definitions (no database)
  art/                background + foreground layers
  _routes.json        keeps the Function off static requests
functions/
  api/cutout.js       background removal endpoint
tools/
  gen_templates.py    regenerates the placeholder artwork
```

## Background removal

`POST /api/cutout`, FormData field `file`, returns a transparent PNG.

Provider is picked by whichever secret exists on the Pages project:

| Secret | Provider | Cost |
|---|---|---|
| `FAL_KEY` | fal.ai BiRefNet v2 | ~$0.001 per photo |
| `REPLICATE_API_TOKEN` | Replicate | ~$0.002 per photo |

With neither set, the endpoint returns 501 and the browser falls back to doing
the cutout on the device. That works, but it downloads a ~40MB model the first
time, which is exactly what we do not want on a slow connection in Africa. Set a
key to turn the fast path on. No code change needed.

```bash
npx wrangler pages secret put FAL_KEY --project-name viago-flyers
```

## Swapping in the real templates

Replace the files in `public/art/` keeping the same names and pixel sizes:

```
<id>-45-bg.jpg   1080x1350     <id>-916-bg.jpg   1080x1920
<id>-45-fg.png   1080x1350     <id>-916-fg.png   1080x1920
```

Then adjust `personTop`, `personHeight` and the `fields` styling for each
template in `public/templates.json`. Nothing else changes.

## Deploy

```bash
export CLOUDFLARE_API_TOKEN=$CLOUDFLARE_PAGES_TOKEN   # from Doppler voyai/dev
export CLOUDFLARE_ACCOUNT_ID=...
npx wrangler pages deploy public --project-name viago-flyers --branch main
```

## Ruled out: auto-generating from the VIAGO back office

Killed by the Chairman 2026-08-07. Two reasons, both fatal:

- The back office has no photos, so there is nothing to cut out.
- Back office names are often not the names used publicly for recognition.

Leaders type the name and upload the photo. That is the design, not a stopgap.
Do not re-propose back-office automation.
