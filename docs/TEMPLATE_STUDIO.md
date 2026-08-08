# VIAGO Template Studio

> This document describes the accepted local development Studio. The permanent operational design is the separately authenticated, GitHub-backed [Hosted Template Studio](HOSTED_TEMPLATE_STUDIO_ARCHITECTURE.md). Hosted publishing uses button confirmation and a Git commit; local promotion continues to require typed `PROMOTE` and writes only the local checkout.

## Purpose and authority

The Template Studio UI is used locally for development and is also the accepted visual-authoring surface for the separately protected hosted product. The local server is not a hosted publishing service; hosted writes use the authenticated GitHub boundary. Neither form is a CMS or persistent template database.

Production authority remains:

```text
layered design source → approved clean artwork → public/templates.json → public/app.js
```

The Studio prepares a draft, previews it with the production renderer, validates it, creates a review artifact, and promotes it only after a deliberate final action.

## Start the Studio

From the repository root, install the pinned development dependencies once and start the local server:

```bash
npm ci
npm run studio
```

Open `http://127.0.0.1:4173/studio/`. The server binds to localhost, not a public interface. Do not deploy the `studio/` directory or its write API as a public administration endpoint.

The same server also supports public-generator review through `npm run app` at `http://127.0.0.1:4173/`. Never review either surface through `file://`; see [Local Review](LOCAL_REVIEW.md).

## Create a new template

1. Choose **New template** and select the approved clean JPEG. The Studio displays its filename, intrinsic dimensions, preview, and SHA-256 checksum.
2. Enter the stable ID, label, category, accent, and position within that category. The order preview shows the proposed catalog position; nothing is alphabetically sorted.
3. Draw the photo region on the artwork, then move or resize it. Choose rectangle or circle/ellipse and optionally load a local sample photo.
4. Drag the name anchor and maximum-width handle. Adjust size, font, weight, color, alignment, case, tracking, wrapping, maximum lines, line height, and vertical alignment. Use the short, two-word, and long-name presets.
5. Switch between **Edit overlay** and **Production preview**. The latter hides authoring guides and uses the existing production Canvas renderer.
6. Enter every known provenance field. Leave unknown values as `unknown`; do not invent them.
7. Select **Validate template**, download the review artifact, and inspect the proposed JSON, checksums, order, validation result, and provenance.
8. Select **Prepare promotion** and review the before checksum, artwork checksum, insertion index, before/after order, and exact target paths.
9. Type `PROMOTE` and select **Promote template to catalog**. No other Studio action writes production files.

Promotion copies the JPEG to `public/art/<id>.jpg` and writes the reviewed entry to `public/templates.json` at the displayed position.

## Edit an existing template

Choose **Existing template**, then select a catalog entry. The Studio loads the current artwork and values into an in-memory draft. Loading, changing, previewing, validating, downloading a review artifact, and preparing a plan do not modify the original.

Review the same plan and type `PROMOTE` to replace the selected catalog record and its approved artwork. The server refuses the operation if the catalog changed after the plan was prepared; reload the current state and prepare a new plan rather than overwriting concurrent work.

## Geometry and production rendering

The authoring canvas calculates the existing contract values directly:

- photo `x` and `y` are the region's left and top divided by canvas width and height;
- photo `w` and `h` are region width and height divided by canvas width and height;
- name `x` and `y` are the normalized name anchor/baseline;
- name `maxWidth` is the displayed name width divided by canvas width; and
- name `size` remains font pixels divided by canvas width.

All values remain visible and numerically editable for precise correction. The Studio does not introduce a photo-rotation template property. Rotation is implemented as end-user uploaded-photo placement state in the public generator, so it correctly remains outside the reusable template contract.

The live composition is produced through the existing `public/app.js` renderer in an isolated local frame. Studio guides are drawn over a copy of that result, so name wrapping/shrinking and photo placement are not reimplemented as a second renderer. Product Improvement 001 therefore flows naturally into Studio production previews at the default 0° placement; the Studio intentionally has no rotation template field or control because rotation belongs to an end user's uploaded-photo placement state.

## Validation and review

The local server builds the proposed catalog and artwork in a temporary repository copy, then invokes `tools/validate_baseline.py`. The validator continues to enforce contract v1, unique IDs, paths, exact JPEG dimensions, fonts, and routing. Studio candidate validation skips only the canonical baseline inventory reconciliation because a proposed catalog is intentionally different; normal release validation does not skip it.

The downloaded review JSON is explicitly marked `REVIEW_ONLY_NOT_PROMOTED`. It records the template object, source/production artwork filename and checksum, dimensions, category/order intent, validation messages, timestamp, and provenance fields. The sample photo is preview-only and is never included in template data or promotion.

## Promotion safety and rollback

Promotion requires all of the following:

- a valid proposed catalog and artwork;
- a unique ID for a new template;
- exact artwork dimensions;
- an explicit category position;
- a freshly prepared plan tied to the current catalog and artwork checksums; and
- the exact typed confirmation `PROMOTE`.

The server stages replacement files, preserves the before bytes in memory, writes artwork and catalog atomically, and runs the validator afterward. If either write or post-promotion validation fails, it restores the previous catalog and artwork. For an operator-directed rollback after a successful promotion, revert the promotion commit in Git or restore both files from the reviewed before state, then run `python3 tools/validate_baseline.py` and the complete regression suite.

The Studio does not commit, push, deploy, publish, infer authoritative geometry, modify Canva sources, or approve brand/provenance decisions.

## Verification commands

```bash
npm run test:studio
python3 tools/validate_baseline.py
python3 -m unittest discover -s tests -p 'test_*.py' -v
npm run test:function
npm run test:browser
npm run test:visual
npm run test:all
```

Automated promotion tests use a temporary repository copy and never mutate the canonical catalog.
