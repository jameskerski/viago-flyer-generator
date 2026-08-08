# Received Baseline: Project Map

## Scope

Paths below are relative to the root of the received `viago-flyers.zip`, not the pre-existing Next.js workspace. "Rendering impact" means a change can alter the preview or downloaded pixels.

## Folder map

| Path | Purpose and owner | Class | Dependencies | Rendering impact |
|---|---|---|---|---|
| `/` | Repository metadata and maintainer entry points; engineering owns it. | Documentation/tooling | Git, Cloudflare operating process | Indirect |
| `public/` | Complete static browser application; product engineering owns behavior and UI. | Runtime/deployment | Browser APIs, Google Fonts, static hosting | High |
| `public/art/` | Flattened production flyer artwork; brand/design owns source, engineering owns export integration. | Assets/templates | `templates.json`, Canvas | Critical |
| `functions/` | Cloudflare Pages Functions root; platform engineering owns deployment behavior. | Runtime/deployment | Cloudflare Workers runtime | None unless cutout used |
| `functions/api/` | HTTP API handlers. | Runtime | fal.ai or Replicate | Photo pixels only |
| `tools/` | Offline template extraction and exceptional image-edit scripts; template maintainers own them. | Scripts/tooling | Python, Pillow, NumPy, Canva exports | High when outputs are adopted |
| `.git/` | Received Git history. Transfer only through an intentional repository migration. | Tooling | Git | None |
| `.wrangler/` | Local Wrangler cache accidentally present in the archive and ignored by Git. | Tooling/transient | Wrangler | None |

There is no tests folder, dependency lockfile, CI configuration, license file, package manifest, or committed hosting configuration beyond `_routes.json`.

## Important files

| File | What it owns | Called/loaded by | Depends on | Modify safety | Rendering impact |
|---|---|---|---|---|---|
| `public/index.html` | DOM contract, four-step workflow, labels, font requests, script/style entry points | Browser navigation | Google Fonts, `styles.css`, `app.js` | Medium risk: IDs are an implicit API used by JS | Indirect to high; font changes alter pixels |
| `public/styles.css` | Exact responsive layout, colors, tap sizes, Canvas display scaling, busy veil, controls | `index.html` | DOM class names | High UX regression risk; test 320/390/430 px and desktop | Does not change intrinsic pixels, but can break interaction/preview |
| `public/app.js` | All state, startup, catalog UI, preprocessing, cutout fallback, gestures, Canvas composition, export | `index.html` | DOM IDs, `templates.json`, Canvas/Pointer/File/Font APIs, CDN module, `/api/cutout` | Highest behavioral risk; change only with regression evidence | Critical |
| `public/templates.json` | Ordered catalog, categories, dimensions, artwork paths, photo geometry, name typography | fetched by `boot()` | matching artwork and fonts | Safe only with per-template visual verification; no runtime validation | Critical and template-specific |
| `public/art/<id>.jpg` | Flattened visual composition and blank placement zones | template `art`; thumbnails and Canvas | exact dimensions/geometry | Replace only with same-size verified export or update registry | Critical |
| `public/_routes.json` | Restricts Function routing to `/api/*` | Cloudflare Pages deploy/runtime | Cloudflare schema | Do not remove; low-frequency, high-blast-radius config | Indirect; removal can make app unavailable |
| `functions/api/cutout.js` | Upload validation, provider selection, provider calls, PNG proxy response | POST `/api/cutout` from `app.js` | Cloudflare env/fetch, fal.ai, Replicate | Security/privacy-sensitive; test success and fallback statuses | Alters photo used when cutout enabled |
| `tools/build_templates.py` | Derives registry geometry from paired Canva PNG exports | Manually invoked | Python, NumPy, Pillow, expected uncommitted input folders | Unsafe to treat output as deterministic today; review before copying output | Critical when output replaces registry |
| `tools/diff_windows.py` | Diagnostic geometry report from original/clean export pairs | Manually invoked | Python, NumPy, Pillow | Read-only analysis; algorithm changes affect recommendations | None until values are adopted |
| `tools/rework_amplified.py` | Repeatable pixel transformation for Amplified artwork | Manually invoked | Python, Pillow, source JPEG | Specialized/high risk; verify visual and pixel dimensions | Critical for Amplified only |
| `tools/amplified-original.jpg` | Untouched source input for the Amplified transformation | `rework_amplified.py` via `--src` when used repeatably | Asset provenance | Do not overwrite | None directly; source of generated art |
| `README.md` | Current technical/operator overview and gotchas | Maintainers | Accurate code knowledge | Safe to edit; keep synchronized | None |
| `HANDOFF.md` | Original transfer checklist and former-owner dependencies | New owner | Ownership facts | Safe to update after facts change; preserve original in history | None |
| `.gitignore` | Excludes `node_modules`, `.wrangler`, `.DS_Store` | Git | repository conventions | Low risk | None |
| `.wrangler/cache/pages.json` | Local account/project cache | Wrangler | former Cloudflare account | Do not use as ownership evidence; remove during cleanup | None |

## Template inventory and order

Array order is behavior. The initial flyer is Club 4.

| # | ID | Label | Category | Canvas | Photo |
|---:|---|---|---|---|---|
| 1 | `club-4` | Club 4 | General | 800×1080 | circle |
| 2 | `mission-30` | Mission 30 | General | 800×1080 | circle |
| 3 | `amplified` | Amplified Bonus | General | 800×1080 | rectangle |
| 4 | `welcome` | Welcome | General | 1080×1080 | rectangle |
| 5 | `silver` | Silver | Ranks | 1080×1080 | rectangle |
| 6 | `gold` | Gold | Ranks | 1080×1080 | rectangle |
| 7 | `sapphire` | Sapphire | Ranks | 1080×1080 | rectangle |
| 8 | `emerald` | Emerald | Ranks | 1080×1080 | rectangle |
| 9 | `elite-emerald` | Elite Emerald | Ranks | 1080×1080 | rectangle |
| 10 | `jacksonville-im` | Jacksonville (Individual) | Events | 800×1080 | circle |
| 11 | `jacksonville-we` | Jacksonville (Couple) | Events | 800×1080 | circle |
| 12 | `cyprus-im` | Cyprus (Individual) | Events | 800×1080 | circle |
| 13 | `cyprus-we` | Cyprus (Couple) | Events | 800×1080 | circle |
| 14 | `kenya` | Kenya | Events | 800×1080 | circle |

All use Josefin Sans Bold and white names. Rank flyers wrap to two lines and stack downward; other templates currently use one line. Thumbnails are the same full artwork files, rendered with CSS `background-size: cover`.

## Dependency map

Runtime dependencies are unmanifested:

- browser Canvas 2D, File/Blob/Object URL, Font Loading, Pointer Events, and `requestAnimationFrame` APIs;
- Google Fonts: Geist, Geist Mono, and Josefin Sans;
- jsDelivr-hosted `@imgly/background-removal@1.6.0` plus its model assets, only on fallback;
- Cloudflare Pages/Functions;
- fal.ai BiRefNet v2 or a pinned Replicate model, when configured.

Tooling dependencies are Python 3, NumPy, and Pillow. Deployment additionally needs Node/npm only to obtain Wrangler through `npx`; no version is pinned.

## Safe-change rule

A change is not safe merely because it is small. Any edit to `app.js`, template geometry, artwork, fonts, Canvas dimensions, or preprocessing must be evaluated by generated-PNG comparison across representative templates, long/short names, portrait/landscape photos, and both pointer and mobile layouts. `_routes.json`, DOM IDs, and the wrap-before-shrink algorithm are protected contracts.

