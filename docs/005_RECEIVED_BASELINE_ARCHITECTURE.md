# Received Baseline: System Architecture

## Status and authority

This document describes the application received as `viago-flyers.zip` on 2026-08-07. That archive, at Git commit `325eb98`, is the authoritative Version 1 behavioral baseline. The pre-existing Next.js code in this workspace is not the baseline. No application code was changed by this documentation package.

The product has one narrow job: a leader selects one of 14 recognition templates, supplies a photo and a name, positions the photo, and downloads a full-resolution PNG. Its simplicity is intentional.

## Architecture at a glance

The application is a static, client-rendered Cloudflare Pages site with one optional Pages Function:

1. `public/index.html` provides the fixed four-step UI and loads fonts, CSS, and `app.js`.
2. `public/app.js` owns all browser state, controls, image preprocessing, Canvas rendering, and export.
3. `public/templates.json` is the runtime catalog and geometry contract for every flyer.
4. `public/art/*.jpg` contains flattened artwork with empty photo/name regions.
5. `functions/api/cutout.js` optionally proxies a photo to fal.ai or Replicate for background removal.
6. `tools/*.py` are offline authoring aids; they never run in production.

There is no framework, bundler, package manifest, database, CMS, account system, or persistent server state. The browser holds the working state in memory. This keeps deployment and operation small, but places a large behavioral responsibility in one JavaScript file and in unvalidated JSON.

## Startup and routing

Cloudflare Pages serves `public/index.html` for `/`. The page synchronously establishes its DOM structure, loads Google Fonts and `styles.css`, and then executes `app.js` as an ES module.

`app.js` captures required DOM nodes and the 2D Canvas context at module evaluation. Its immediately invoked `boot()` then:

1. marks the status as Loading;
2. fetches `templates.json` relative to the page;
3. stores `data.templates` without schema validation;
4. derives category order from the first occurrence of each category;
5. selects the first template in the first category;
6. builds category and template controls;
7. waits for Josefin Sans Bold when the Font Loading API is available;
8. renders the initial artwork; and
9. marks the status Ready.

`public/_routes.json` sends only `/api/*` to Pages Functions. All other requests remain static. This is load-bearing deployment configuration: broad Function routing has previously caused static-asset failures.

There are no client-side routes. Selection changes in memory and is not represented in the URL. Refresh resets the entire session.

## Runtime state and ownership

The singleton `state` object in `app.js` is the model:

- `templates`, `category`, and `templateId` own catalog and selection;
- `name` owns the current typed name;
- `photo` owns the decoded display image and its object URL;
- `original` owns the compressed upload used to toggle cutout on and off;
- `place.dx`, `place.dy`, and `place.zoom` own photo placement; and
- `cutoutOn` mirrors the toggle.

DOM controls are the view/controller boundary. Event listeners mutate state, update control visibility or copy, and request rendering. Nothing persists to local storage or a server.

## Canvas rendering pipeline

The Canvas is both preview buffer and export buffer. `render()` is the canonical composition function:

1. Resolve the selected template.
2. Resize the Canvas intrinsic dimensions to the template's `w` and `h`; resizing also resets Canvas state.
3. Load and cache the flattened artwork using `loadImage()`.
4. Clear the Canvas and draw artwork across the full output dimensions.
5. If a photo exists, convert fractional template geometry to pixels, create a rectangular or elliptical clipping path, scale the photo with a cover calculation, apply normalized drag offsets and zoom, and draw it inside the clip.
6. Draw the name last using the template's font, weight, color, tracking, alignment, case, width, wrapping, line-height, and vertical-alignment rules.

This order is important. The artwork files are not overlays with transparent windows; the photo is painted after the flattened artwork into deliberately blank regions. Moving a photo region over nonblank artwork will cover that artwork.

`scheduleRender()` coalesces repeated UI changes into one `requestAnimationFrame` callback. Rendering is asynchronous because artwork may need to load. Artwork promises are cached by path. There is no render generation token, so unusually fast template changes can allow an older asynchronous render to finish after a newer request; this is a hardening concern, not a reason to change Version 1 behavior in this package.

### Name rendering

Names are uppercased when configured. Text width includes tracking; browsers without `CanvasRenderingContext2D.letterSpacing` use manual per-character measurement and painting.

For wrapped templates, line breaks are chosen at the configured size. If too many lines result, size is reduced and wrapping is recalculated until the maximum line count is met. Once line breaks are accepted, they are held while size reduces to satisfy width. This "wrap before shrink" rule prevents long names from collapsing into one very small line.

Vertical placement has three meanings:

- omitted: `y` is the final line's baseline and earlier lines stack upward;
- `top`: `y` is the first baseline and later lines stack downward; and
- `middle`: the block is centered on `y` using actual glyph metrics.

Text receives a proportional shadow. Browser font and Canvas metric differences can therefore change output pixels.

## Template loading and selection

`templates.json` is an ordered registry. The array order controls category order, chip order, initial category, and initial template. Each chip uses the full artwork as a CSS background thumbnail; there are no separate thumbnail assets.

Selecting a category selects that category's first template. Selecting any template resets drag and zoom. The uploaded photo and typed name remain in memory and are re-rendered into the newly selected template.

The runtime contract is described in the authoring guide. Coordinates are fractions of template width/height so geometry remains tied to an artwork's dimensions.

## Upload and image preprocessing lifecycle

The hidden file input accepts `image/*`. `handleFile()`:

1. shows a busy veil;
2. calls `compress(file, 1800)`;
3. resets placement and zoom;
4. stores the resulting Blob as `state.original`;
5. optionally runs cutout; otherwise decodes that Blob through `useBlob()`; and
6. exposes photo controls and requests a render.

`compress()` decodes the local file through an object URL. Files whose longest side is at most 1,800 pixels and size is under 2 MB are retained byte-for-byte. Others are redrawn into an offscreen Canvas at a maximum 1,800-pixel side and encoded as JPEG at quality 0.92. This normalizes large uploads and reduces transfer/memory cost, but it removes original encoding, transparency, animation, and metadata on the recompression path.

`useBlob()` decodes a Blob to an Image, revokes the previously displayed photo URL, stores the new image/URL pair, and updates controls. Clearing revokes the displayed URL and removes in-memory upload state.

## Background-removal pipeline

Background removal is optional and off by default because Version 1 artwork expects ordinary photographs in frames.

When enabled, `applyCutout()` first posts the compressed `state.original` Blob as `file` to `/api/cutout`. The Function:

1. parses multipart form data;
2. requires a file no larger than 12 MiB;
3. reads the whole file, base64-encodes it, and constructs a data URI;
4. selects fal.ai when `FAL_KEY` exists, otherwise Replicate when `REPLICATE_API_TOKEN` exists;
5. sends the entire photo to that provider;
6. fetches the provider's result URL; and
7. streams it back as uncached `image/png`.

No configured provider produces HTTP 501. Any server failure causes the browser to dynamically import pinned `@imgly/background-removal@1.6.0` from jsDelivr and run removal locally. That fallback downloads a large model on first use. If both paths fail, the original compressed image is restored and the toggle is switched off.

Photos are not intentionally persisted by this code, but enabling cutout discloses the photo to a third-party provider. Provider retention terms, logs, and result-URL exposure are organizational privacy concerns.

## Drag and zoom interaction

Pointer events support mouse, pen, one-finger drag, and two-finger pinch. Placement is normalized relative to the selected photo window rather than the whole Canvas, allowing it to transfer consistently across display sizes.

One pointer records a drag origin and starting offsets. Movement is divided by the displayed photo-window width/height and clamped to `[-1, 1]`. Two pointers record their initial distance and starting zoom; the distance ratio changes zoom, clamped to `[1, 3]`. The range input controls the same zoom from 100–300%. Pointer capture keeps the gesture active when it leaves the Canvas.

Offsets are not constrained to prevent empty clipped areas. Cover scaling guarantees a filled window at the centered starting position, but extreme drag can expose blanks. This is existing behavior.

## Preview, PNG, and export lifecycle

CSS scales the full-resolution Canvas responsively without changing its intrinsic pixels. Therefore the visible preview and export use the same composition buffer.

Download calls `render()` directly to finish a fresh composition, then `canvas.toBlob(..., 'image/png')`. A temporary anchor downloads the Blob. The filename is the trimmed, lowercased name with non-alphanumeric runs replaced by hyphens, followed by `-<templateId>.png`; an empty or non-Latin-only name becomes `flyer`.

Canvas export depends on all drawn resources remaining origin-clean. Current artwork is same-origin and Google Fonts affect text metrics but are not drawn as image resources. Future remote artwork without proper CORS would taint the Canvas and break export.

## Asset and template organization

- `public/art/`: production-ready, flattened JPEGs. Five rank images and Welcome are 1080×1080; the remaining eight are 800×1080.
- `public/templates.json`: ordered geometry and typography registry for all 14 images.
- `tools/amplified-original.jpg`: repeatable source for the exceptional Amplified pixel edit.
- authoring inputs expected by `build_templates.py`: `tools/canva/*.png` and `tools/clean/*.png`; these folders are not included in the received archive.

Runtime assets and authoring sources must not be conflated. The JPEGs are deployable outputs; layered Canva files are the maintainable sources and must be transferred separately.

## Deployment model

Cloudflare Pages serves `public/` and discovers `functions/`. Deployment currently relies on a locally available or `npx`-downloaded Wrangler version and environment credentials. `FAL_KEY` or `REPLICATE_API_TOKEN` is stored as a Pages secret, never in the repository. Optional model identifiers can be overridden with `FAL_MODEL` and `REPLICATE_VERSION`.

The received archive includes `.wrangler/cache/pages.json` with a Cloudflare account ID and project name. That cache is ignored by Git and is not authoritative configuration; it should not be distributed in future handoffs.

