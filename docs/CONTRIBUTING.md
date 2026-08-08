# Contributing

## Scope

Keep this a small static application. Do not introduce Next.js, React, a database, authentication, accounts, a CMS, a redesign, or workflow change without a separately approved architecture/product decision.

Use `npm run app` and `http://127.0.0.1:4173/` for public local review. Never use `file://`; follow [`LOCAL_REVIEW.md`](LOCAL_REVIEW.md).

## Change process

1. State the objective defect or authorized maintenance need.
2. Identify whether the change affects runtime, rendering, artwork, template data, deployment, privacy, or documentation.
3. Preserve a before-state PNG and relevant mobile/desktop evidence.
4. Make the smallest scoped change. Do not opportunistically clean `app.js`, HTML, CSS, registry, artwork, or Function code.
5. Validate according to the maintenance and authoring guides.
6. Explain every runtime-byte difference and attach output comparisons.
7. Update affected documentation and provenance in the same review.

Template tools may suggest geometry. A person must review and explicitly promote values into `public/templates.json`.

Use `npm run studio` for the visual authoring workflow and follow [`TEMPLATE_STUDIO.md`](TEMPLATE_STUDIO.md). Validation, review-artifact generation, and plan preparation are intentionally non-mutating. Inspect the exact paths and before/after order, then type `PROMOTE` only for an approved change. Commit `public/templates.json` and its `public/art/<id>.jpg` together; never deploy `studio/` as a public administration surface.

## Pull-request evidence

- purpose and authorization;
- files and protected decisions affected;
- before/after PNGs when pixels can change;
- tested templates, names, photos, devices, browsers, cutout paths, and routing as applicable;
- privacy/security/license review when applicable;
- rollback plan; and
- documentation/provenance updates.

No application behavior change was authorized during Phase B.

For Studio changes, run `npm run test:studio` and the complete public-generator suite. Promotion tests must use a temporary repository and must never write the canonical registry.
