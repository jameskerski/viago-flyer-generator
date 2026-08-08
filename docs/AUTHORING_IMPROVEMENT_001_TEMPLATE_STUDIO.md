# Authoring Improvement 001: Template Studio Completion Record

## Result

`TEMPLATE_STUDIO_ACCEPTED`

Completed on 2026-08-07 against canonical baseline commit `7f612a726d9c0b276df361dd954f1f70e863758f`.

## Delivered architecture

The private authoring surface is static HTML/CSS/browser JavaScript under `studio/`, served by a small localhost-only Node server. The same server supplies the unchanged public application to an isolated preview frame, exposes narrowly scoped Studio catalog/validation/plan/promotion endpoints, and invokes the existing Python validator. No framework, database, account system, public admin endpoint, or production Cloudflare change was added.

The authoring preview delegates composition to `public/app.js`; the Studio adds only interactive authoring guides. Drafts remain in browser memory. Production truth remains `public/templates.json` and `public/art/`.

## Delivered workflow

- New and existing-template draft modes.
- JPEG selection, intrinsic dimensions, preview, and checksum.
- Template ID, label, existing/new category, accent, and category-relative insertion position.
- Direct photo-region draw, move, resize, and rectangle/circle selection with visible normalized values.
- Local synthetic or operator-selected sample photo; never promoted.
- Direct name-anchor and maximum-width manipulation plus every contract v1 name control and short/two-word/long presets.
- Edit-overlay and production-preview modes.
- Validator-backed actionable results and a downloadable review-only JSON artifact with provenance.
- Hash-bound change plan and guarded promotion requiring typed `PROMOTE`.
- Atomic writes, post-write validation, and automatic restoration on promotion failure.

## Safety evidence

Preview, field edits, validation, review downloads, and plan preparation do not write production. The browser cannot choose arbitrary repository paths. The server derives `public/art/<validated-id>.jpg`, rejects stale plans, and allows promotion only on loopback. Successful-promotion coverage operates exclusively on a temporary repository copy and verifies that all prior templates remain byte-for-byte equivalent.

No accepted Photo Rotation successor was present, so the Studio does not invent a rotation contract property.

## Test evidence

The Studio suite covers opening/loading, candidate artwork metadata, direct photo and name manipulation, shape selection, normalized geometry, name presets/options, production preview, category/order intent, duplicate/dimension failures, review generation, non-mutation before confirmation, and explicit promotion in a temporary repository with post-promotion validation.

Final accepted results:

- `npm run test:studio`: 6 passed.
- `python3 tools/validate_baseline.py`: 14-template baseline passed.
- Python validator fixtures: 2 passed.
- `npm run test:function`: 3 passed.
- `npm run test:browser`: 15 passed, 1 documented trusted-multitouch skip.
- `npm run test:visual`: 2 passed, covering the accepted 16-image baseline.
- `npm run test:all`: 26 passed, 1 documented trusted-multitouch skip, plus validator success.

The final diff against the starting baseline contains no files under `public/` or `functions/`; public generator and Cloudflare runtime bytes are unchanged.
