# Received Baseline: System Maintenance Guide

Hosted publication and retirement are defined in [Hosted Template Studio architecture](HOSTED_TEMPLATE_STUDIO_ARCHITECTURE.md). GitHub is the published source of truth and Git revert is rollback; do not create a parallel datastore.

## Maintenance principle

Version 1 intentionally centralizes variation in artwork and `templates.json`, while `app.js` provides one shared renderer. Prefer data/art changes for template-specific needs and code changes only for behavior shared by the product. Preserve the existing workflow and Canvas pipeline.

Before any change, capture representative PNG outputs and the deployed mobile/desktop views. Afterward, compare those same cases. The preview alone is insufficient when the change touches intrinsic rendering.

Run `python3 tools/validate_baseline.py` before and after every template, artwork, font-declaration, routing, or baseline-manifest change. The validator is read-only and dependency-free. A pass proves structural/repository consistency; it does not prove visual correctness, design approval, browser behavior, accessibility, privacy, licensing, or deployment readiness. Those remain separate review gates.

From Phase E onward, run `npm ci` once and then `npm run test:all` for complete local regression evidence. Browser and visual tests use a deterministic localhost server; never substitute `file://`. Visual checks require the pinned Playwright Chromium and successful delivery of the existing Google-hosted Josefin Sans font. Review snapshot changes rather than updating them automatically as a way to make a failure pass.

For visual template maintenance, use the localhost-only [VIAGO Template Studio](TEMPLATE_STUDIO.md). Loading and editing produce drafts only. Validation and review are non-mutating; promotion requires a valid checksum-bound plan and typed `PROMOTE`. After a promotion, commit the catalog and artwork together. To roll back, revert both together and rerun the validator and full suite.

## Changing UI colors

UI colors live as CSS custom properties at the top of `public/styles.css`, with some component-specific values later in the file. Change tokens first so related states remain coherent. Verify normal, hover/focus, selected, busy, warning, and disabled/hidden states and contrast.

Template-chip accents are per-template `accent` values in `templates.json`. They communicate selection and do not recolor artwork. Artwork colors are baked into each JPEG and require a design-source re-export.

Reasoning: interface theme, selection accents, and branded flyer pixels are separate ownership layers and should remain separate.

## Changing fonts

UI fonts are requested in `index.html` and referenced by CSS. Flyer name fonts are requested there but selected per template in JSON and applied by Canvas.

For a flyer font change:

1. confirm license permits web delivery and exported marketing use;
2. add the exact family/weights to the font request or self-hosted declarations;
3. update template `font` and `weight`;
4. retune `size`, `tracking`, `maxWidth`, and possibly baselines; and
5. compare short and long names across browsers.

Canvas metrics are font-specific. Changing only the family is not a cosmetic swap; it changes wrapping and alignment. External Google Fonts are also an availability/privacy dependency. A future hardening phase may self-host pinned font files without changing their visual identity.

## Changing wording

Fixed UI wording and accessibility labels are in `index.html`. Dynamic status, progress, note, and filename behavior are in `app.js`. Flyer label/category text is in `templates.json`; text baked into flyer art requires a source-design export.

Preserve DOM IDs when changing copy. IDs are the private interface between HTML and `app.js`. Keep the four numbered steps and workflow unchanged unless a separate product decision explicitly authorizes it.

## Adding or renaming categories

Categories are derived from template entries; there is no separate category registry. Add or change the exact `category` string. The first occurrence determines tab order and its first template is selected when the category is clicked.

Reasoning: this convention avoids duplicate configuration in a small app. Its cost is hidden ordering behavior, so review the full array whenever categories change.

## Changing template ordering and defaults

Reorder objects in `templates.json`. Order controls:

- category order by first occurrence;
- template order within category;
- initial category; and
- initial template (first entry in the first category).

To change the default without changing visible order would require a behavior change in `boot()` and should wait for a typed contract/default-property phase rather than introducing a one-off constant.

## Adding or replacing backgrounds/artwork

Follow the authoring guide. Preserve exact dimensions when replacing an existing file. If dimensions change, update `w`, `h`, all photo/name geometry, and typography sizing and reapprove the result.

The Studio copies candidate artwork into `public/art/<id>.jpg` only during explicit promotion. Local sample photos are preview-only and must never enter the catalog or artwork directory.

JPEGs are flattened compositions. Logos, colors, and background elements cannot be safely edited as independent components in code. Use the layered design source, export a new clean asset, and retain provenance.

## Changing logos

Current logos are baked into artwork. Change them in Canva/layered source for every affected template, then replace approved outputs. UI branding (the Recognition Studio mark and footer) is HTML/CSS and separate from flyer branding.

Check trademark authorization, clear space, contrast, and every output dimension. Avoid pixel surgery except when documented as a temporary, reproducible exception like `rework_amplified.py`.

## Changing output resolution

Output resolution is template-specific `w`/`h`. The Canvas is resized to those values and artwork is stretched to fill. A resolution change therefore requires a matching artwork export and geometry verification. Fractional coordinates scale, while visual typography can still differ because raster art detail, font rasterization, and shadows change.

Upload preprocessing caps the longest source-photo side at 1,800 pixels. Outputs or photo zones approaching/exceeding that may expose interpolation limits; revisit that cap as part of the same reviewed change. Do not change CSS size expecting output resolution to change—CSS only changes the preview.

## Changing filename conventions

The download handler in `app.js` owns filenames. Today it ASCII-slugifies the name and appends the template ID. Changes can affect downstream content workflows and should specify examples for empty names, punctuation, diacritics, non-Latin names, duplicates, and illegal platform characters. Keep the `.png` extension aligned with `toBlob` format.

Filename changes do not affect pixels but are production behavior and require acceptance tests.

## Changing default behavior

Defaults are distributed intentionally close to their state:

- first category/template: registry order and `boot()`;
- no name/photo: empty state;
- zoom and offsets: `state.place`, `select()`, and upload handling;
- photo rotation: `state.place.rotation` plus the Rotation range control; it resets with zoom and offsets and is never template data;
- cutout off: HTML checkbox plus `state.cutoutOn`;
- name field fallbacks: `drawName()`; and
- provider/model precedence: `cutout.js`.

Change all mirrored values together. For example, a different zoom default must update state and the range control. Document the user-facing reason and test fresh boot, template switch, upload replacement, clear, and cutout toggle.

Product Improvement 001 extends placement with rotation from −180° to +180°. The renderer rotates around the active photo-window center and derives the minimum rotated cover scale from exact inverse-rotated window extents before applying user zoom. At 0° it must reduce to the accepted cover calculation and pass every original Phase E visual baseline. See [`PRODUCT_IMPROVEMENT_001_PHOTO_ROTATION.md`](PRODUCT_IMPROVEMENT_001_PHOTO_ROTATION.md).

Do not move rotation into `templates.json`, add gesture rotation, or alter the accepted ±1 over-drag clamps as part of rotation maintenance. Pinch remains zoom-only.

## Adding future template properties

Use this sequence:

1. state the rendering need and prove existing fields cannot express it;
2. define type, units, allowed values, default, and compatibility behavior;
3. add runtime validation before relying on it;
4. implement a default that exactly preserves all 14 existing templates;
5. opt in one new/fixture template;
6. add pixel/behavior tests; and
7. document it in the authoring contract.

Contract v1 lives at `contracts/templates.schema.v1.json` and is explained in `docs/TEMPLATE_CONTRACT.md`. Future contracts must accept existing Version 1 data and preserve effective defaults unless an explicit breaking behavior change is separately approved. Contract/schema files are tooling documentation and must never become a duplicate runtime catalog.

Keep properties declarative and rendering-specific. Do not put executable expressions or template-specific branches in JSON. Likely safe future examples are explicit photo rotation or name shadow parameters; each still needs a product-approved requirement.

## Background-removal maintenance

Secrets belong in the Viago Cloudflare project. Rotate them per policy and never commit them. Test these paths independently: fal success, Replicate success, no provider (501), provider error (502), oversize upload (413), and browser fallback.

Review provider model identifiers, API contracts, price, retention, data residency, and the pinned browser library/model before upgrades. Because user photos may be personal data, changes require privacy review, not only functional testing.

## Deployment maintenance

Deploy `public/` as the Pages directory with `functions/` available to the platform. Preserve `_routes.json`. Pin Wrangler and add a CI deployment workflow during hardening; until then record the exact Wrangler version used for each release.

After deployment, verify repeated asset requests return the new version, then run a production smoke test: boot, each category, one upload, drag/zoom, name render, PNG download, and configured cutout/fallback. Maintain an immediate rollback artifact and previous deployment.

## Troubleshooting

| Symptom | Most likely checks |
|---|---|
| Load failed | `templates.json` syntax/path, artwork 404, static routing, browser console |
| Wrong initial flyer/order | array order and exact category strings |
| Blank/misaligned photo | artwork dimensions, normalized geometry, decoded source dimensions |
| Empty edges after drag | existing ±1 offset permits over-drag; reset/recenter and assess a future constrained-placement fix |
| Wrong name wrap | font loaded/weight available, `maxWidth`, `size`, `wrap`, `maxLines`, protected wrap-before-shrink algorithm |
| Preview layout overflows mobile | `min-width:0`, Canvas `max-width`, sticky-stage pointer rules |
| Download fails | Canvas console error, remote/CORS-tainted artwork, Blob support, render/load race |
| Cutout slow | server not configured/reachable, browser model first download |
| Static files intermittently fail | `_routes.json`, Cloudflare deployment propagation |
