# VIAGO Flyer Generator Documentation

## Canonical status

This repository is the canonical Version 1 implementation received in `viago-flyers.zip`. Its production architecture is static HTML, CSS, browser JavaScript, Canvas, an ordered JSON template catalog, flattened artwork, and one optional Cloudflare Pages Function.

The earlier Next.js implementation is superseded. Do not merge it into this repository or reinterpret it as the product architecture.

## Start here

- [Local public-generator and Template Studio review](LOCAL_REVIEW.md)
- [Phase B canonical-repository record](PHASE_B_RECORD.md)
- [Template contract v1](TEMPLATE_CONTRACT.md)
- [Phase C/D completion record](PHASE_C_D_RECORD.md)
- [Phase E regression-evidence record](PHASE_E_RECORD.md)
- [VIAGO Template Studio operator guide](TEMPLATE_STUDIO.md)
- [Authoring Improvement 001 completion record](AUTHORING_IMPROVEMENT_001_TEMPLATE_STUDIO.md)
- [Product Improvement 001: photo rotation](PRODUCT_IMPROVEMENT_001_PHOTO_ROTATION.md)
- [Product Improvement 002: header branding](PRODUCT_IMPROVEMENT_002_HEADER_BRANDING.md)
- [Machine-readable baseline manifest](baseline-manifest.json)
- [Ownership and provenance](OWNERSHIP_AND_PROVENANCE.md)
- [Contribution guidance](CONTRIBUTING.md)
- [Release guidance](RELEASING.md)

## Architecture and maintenance package

1. [System architecture](005_RECEIVED_BASELINE_ARCHITECTURE.md)
2. [Project map](006_RECEIVED_BASELINE_PROJECT_MAP.md)
3. [Template authoring guide](007_TEMPLATE_AUTHORING_GUIDE.md)
4. [System maintenance guide](008_SYSTEM_MAINTENANCE_GUIDE.md)
5. [Senior architecture review](009_ARCHITECTURE_REVIEW.md)
6. [Takeover plan](010_TAKEOVER_PLAN.md)
7. [Phased hardening roadmap](011_PHASED_HARDENING_ROADMAP.md)
8. [Received-baseline index](005-011_RECEIVED_BASELINE_INDEX.md)

## Protected decisions

- `public/templates.json` is the runtime catalog and geometry authority.
- `public/app.js` is the shared renderer.
- Layered Canva/design files are visual-design authority; approved exports are production assets.
- Authoring tools may suggest geometry, but promotion is explicit and reviewed.
- Phase B made no changes to runtime files or user-visible behavior.
- Phase C/D added a read-only contract and validator; `public/templates.json` remains the sole runtime catalog.
- Phase E added development-only browser, Function, responsive, accessibility-smoke, download, cutout-mock, and visual regression gates; production runtime bytes remain unchanged.
- Authoring Improvement 001 added a separate localhost-only visual Template Studio; it cannot mutate the catalog until a validated plan and explicit typed promotion.
- Product Improvement 001 added per-upload photo rotation from −180° to +180° without changing template data, catalog order, artwork, or the accepted editor workflow.
- Product Improvement 002 added the official VIAGO logo to the public Pick a flyer panel without reducing category or template-row width.

No repository license is present. Code, artwork, source-design, font, and third-party rights remain an explicit takeover gate; see the ownership record.
