# VIAGO Recognition Flyer Tool

Permanent operations manual: [`FINAL_PLATFORM_HANDOFF.md`](FINAL_PLATFORM_HANDOFF.md)

> **Hosted publishing:** GitHub is the authoritative published catalog/artwork state; Canva/Drive remains editable-source storage; Cloudflare hosts the static public generator; and a separately protected Google-authenticated Template Studio publishes atomic Git commits. Access is limited to verified `@goodlifetrainings.com` Google identities, with no admin roster or database. See [`docs/HOSTED_TEMPLATE_STUDIO_ARCHITECTURE.md`](docs/HOSTED_TEMPLATE_STUDIO_ARCHITECTURE.md) and [`docs/PLATFORM_OPERATOR_GUIDE.md`](docs/PLATFORM_OPERATOR_GUIDE.md).

> **Canonical Version 1 repository.** This plain HTML/CSS/JavaScript and Canvas
> application is the adopted product architecture. The earlier Next.js
> implementation is superseded and must not be merged into this product.
> Start with [`docs/INDEX.md`](docs/INDEX.md) for architecture, ownership,
> authoring, maintenance, and release guidance.

Leaders pick a flyer, drop in a photo, type a name, download. Replaces Snapp
(app.getsnapp.ai/viago).

## Local review

```text
PUBLIC GENERATOR
npm run app
http://127.0.0.1:4173/

TEMPLATE STUDIO
npm run studio
http://127.0.0.1:4173/studio/
```

Never review through `file://`. ES-module and `fetch('templates.json')` behavior differs for local files, so an empty static shell is not a valid product review. See [`docs/LOCAL_REVIEW.md`](docs/LOCAL_REVIEW.md).

## Live deployments

- Public Generator: `https://viago-flyer-generator.pages.dev/`
- Private Template Studio: `https://viago-template-studio-worker.noisy-bread-8a99.workers.dev/`

The public generator is unauthenticated and embeddable. The Studio is protected by Cloudflare Access and accepts only verified Google identities ending exactly in `@goodlifetrainings.com`.
The public header links unobtrusively to the private Studio. Inside the Studio, **Admin Instructions** opens the approved protected guide in a new tab without clearing the current draft.

Hosted publication uses the narrowly installed **VIAGO Template Studio Publisher** GitHub App. It is installed only on this repository with Contents read/write and mandatory Metadata read-only; short-lived installation credentials remain server-side in Cloudflare.

---

## How it works

Each template is a flat piece of artwork with a **window** cut into it, either a
rectangle or a circle. The photo goes into that window. Nobody is cut out and
stood on the artwork, which is how Snapp works but not how these templates are
drawn.

Everything renders on one `<canvas>` at the template's full export size, so the
preview is literally the file that downloads. Draw order:

1. the artwork (`public/art/<id>.jpg`)
2. the photo, clipped to the window, scaled to cover it, plus the leader's drag
   and zoom
3. the name

There is no build step, no framework and no database. It is plain HTML, CSS and
one JavaScript file.

```
public/
  index.html        the page
  app.js            renderer and all UI logic
  styles.css
  templates.json    every template's geometry and text styling
  art/              14 template images
  _routes.json      keeps the Function off static requests (see Gotchas)
functions/
  api/cutout.js     optional background removal endpoint
tools/
  build_templates.py     regenerates templates.json from Canva exports
  rework_amplified.py    the pixel edit applied to the Amplified artwork
  amplified-original.jpg untouched Amplified export, so that edit is repeatable
```

## templates.json

One entry per template. The important parts:

```jsonc
{
  "id": "gold",
  "category": "Ranks",          // General | Ranks | Events, and tab order
  "label": "Gold",              // what the leader sees
  "art": "art/gold.jpg",
  "w": 1080, "h": 1080,         // export size
  "photo": {                    // the window, as fractions of w/h
    "shape": "rect",            // rect | circle
    "x": 0.55093, "y": 0.28981, "w": 0.3787, "h": 0.51019
  },
  "name": {
    "x": 0.48889, "y": 0.15,    // x is the centre, y is a baseline
    "size": 0.05463,            // fraction of width, so it scales
    "maxWidth": 0.62,
    "font": "Josefin Sans", "weight": 700, "color": "#ffffff",
    "align": "center", "case": "upper",
    "wrap": true, "maxLines": 2, "lineHeight": 1.12,
    "vAlign": "top"             // top | middle | (omit for baseline)
  }
}
```

`vAlign` decides where extra lines go:

- omitted: `y` is the **last** line's baseline, extra lines stack **upward**
- `"top"`: `y` is the **first** line's baseline, extra lines stack **downward**
- `"middle"`: the block is centred on `y` using real glyph metrics

Long names **wrap before they shrink**. The line breaks are decided at the
template's own font size and then held; the size only scales down if a line
still will not fit. Do not re-wrap after shrinking, or a long name collapses
back onto one tiny line.

## Changing a template

**Move the photo window or the name:** edit `templates.json`. Nothing else.

**Replace the artwork:** drop a new file at `public/art/<id>.jpg` at the same
pixel size, then check the window still lines up.

**Add a template from Canva:** export the page twice, once as-is and once with
the photo placeholder and the name text deleted. `tools/build_templates.py`
diffs the two: whatever changed is the photo window and the name box. Circles
are detected by their fill ratio landing near pi/4.

## Background removal

Optional, off by default, because these templates want an ordinary photo in a
frame. `POST /api/cutout` takes FormData `file` and returns a transparent PNG.

| Secret on the Pages project | Provider | Cost |
|---|---|---|
| `FAL_KEY` | fal.ai BiRefNet v2 | ~$0.001 per photo |
| `REPLICATE_API_TOKEN` | Replicate | ~$0.002 per photo |

No Viago-owned paid provider key is configured. With no key the endpoint returns 501 and the browser falls
back to removing the background on the device, which works but downloads a
~40MB model first.

```bash
npx wrangler pages secret put FAL_KEY --project-name viago-flyers
```

**The key is not in this repo and must never be committed.**

## Deploy

```bash
export CLOUDFLARE_API_TOKEN=...        # a token with Pages edit rights
export CLOUDFLARE_ACCOUNT_ID=...
npx wrangler pages deploy public --project-name viago-flyers --branch main
```

## Gotchas, all learned the hard way

- **Cloudflare edges update unevenly.** After deploying, request the same file
  about six times and only test once every response has the new content.
  Otherwise a test hits a stale edge and reports a fixed bug as still broken.
- **`_routes.json` matters.** Without it the Function intercepts every request,
  including static files, and returns intermittent 522s.
- **`[hidden]` loses to flex and grid `display` rules**, hence
  `[hidden]{display:none !important}`.
- **The canvas has an intrinsic 1080px width.** Ancestors need `min-width:0`
  and `max-width:100%` or the page overflows sideways on a phone.
- **The sticky preview must be `pointer-events:none`** with the canvas
  re-enabled, or its decorative gradient eats taps meant for the controls.
- **Every tap target is at least 44px.** Verified at 320, 390 and 430px wide.
  The name input stays at 16px font so iOS does not zoom when it is focused.

## Deliberately not built

Auto-generating flyers from VIAGO back office data. Ruled out: the back office
holds no photos, and the names there are often not the names used publicly for
recognition. Leaders type the name. That is the design, not a stopgap.

## Source artwork

The templates come from a Canva design owned by Matt. The exports here already
have the placeholder picture and the word NAME removed. The artwork is
**flattened**, so parts of a template cannot be moved without redoing them
pixel by pixel (see `tools/rework_amplified.py`). For any real layout change,
get the layered source from whoever designed them.
