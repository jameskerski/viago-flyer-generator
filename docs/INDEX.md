# VIAGO Flyer Generator Documentation

## Canonical status

This repository is the canonical Version 1 implementation received in `viago-flyers.zip`. Its production architecture is static HTML, CSS, browser JavaScript, Canvas, an ordered JSON template catalog, flattened artwork, and one optional Cloudflare Pages Function.

The earlier Next.js implementation is superseded. Do not merge it into this repository or reinterpret it as the product architecture.

## Start here

- [Phase B canonical-repository record](PHASE_B_RECORD.md)
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

No repository license is present. Code, artwork, source-design, font, and third-party rights remain an explicit takeover gate; see the ownership record.
