# Phase C/D Record: Typed Contract and Baseline Validation

## Result

`PHASE_C_D_ACCEPTED`

Contract v1 and a deterministic, read-only validator were added without changing production runtime bytes or the 14-template catalog.

## Deliverables

- `contracts/templates.schema.v1.json`: transparent JSON Schema description of Version 1.
- `tools/validate_baseline.py`: dependency-free validator; never writes repository data.
- `tests/fixtures/negative-cases.json`: declared negative scenarios.
- `tests/test_validator.py`: temporary-copy tests that never mutate production data.
- `docs/TEMPLATE_CONTRACT.md`: exact fields, defaults, ordering, compatibility, and scope.

## Validation scope

The validator checks registry JSON and exact supported fields, IDs/enums/numbers/geometry, artwork path convention/existence/readability/dimensions, Google Fonts family/weight declarations in `public/index.html`, exact `/api/*`-only routing, baseline-manifest IDs/count/art inventory, and optional authoring input pairing.

Absent `tools/canva/` and `tools/clean/` are reported as an expected warning. If present, both must be directories with matching filenames. Nothing is promoted.

## Negative evidence

Tests prove non-zero, actionable failures for duplicate IDs, invalid photo shape, invalid alignment enum, non-finite geometry, missing artwork, dimension mismatch, traversal, missing required property, malformed JSON, unsupported font declaration, broken routing, and unsupported template properties.

## Runtime integrity

No bytes changed in `public/index.html`, `public/styles.css`, `public/app.js`, `public/templates.json`, `public/art/*`, `public/_routes.json`, or `functions/api/cutout.js`. The current 14 templates pass unchanged.

## Limits and next phase

This phase does not visually render flyers or automate a browser and does not prove accessibility, privacy, rights, Cloudflare ownership, or deployment readiness. Phase E may add automated baseline and visual regression testing when authorized; it has not begun.
