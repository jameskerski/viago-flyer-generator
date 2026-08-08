# Received Baseline: Phased Hardening Roadmap

## Guardrails

Every phase preserves Version 1 UI, workflow, Canvas rendering model, and output appearance unless fixing a demonstrated objective defect. No CMS, database, authentication/account system, redesign, or unnecessary abstraction is in scope. Each phase should be independently reviewable and releasable.

## Phase A — Documentation complete

**Objective:** Eliminate reverse engineering as a maintenance prerequisite.

**Scope:** Approve architecture, project map, authoring, maintenance, review, takeover, and roadmap documents; record archive checksum/commit; create owner/contact and browser-support records; reconcile README/HANDOFF facts.

**Risk:** Documentation may encode unverified statements or drift from the received archive.

**Expected outcome:** A new developer or template administrator can explain, deploy, troubleshoot, and add a flyer with known caveats. No runtime change.

**Exit evidence:** Engineering, design/template owner, platform, and privacy reviewers sign off; every referenced path/field matches the baseline.

## Phase B — Repository cleanup

**Status:** Completed as repository normalization on 2026-08-07. See [`PHASE_B_RECORD.md`](PHASE_B_RECORD.md). Legal, Canva, Cloudflare, and provider/privacy ownership remain explicit takeover gates; they do not change the repository-normalization result.

**Objective:** Establish a clean, Viago-owned canonical repository without altering behavior.

**Scope:** Import received Git history into a clean Viago repo; add LICENSE/NOTICE after legal review; exclude `.wrangler` cache and OS artifacts; define CODEOWNERS, contribution/release notes, artifact provenance, and source-storage links; resolve the separate earlier Next.js workspace rather than mixing implementations.

**Risk:** Accidental loss of history/assets or unintended changes during import.

**Expected outcome:** One unmistakable baseline, clean checkout, explicit ownership, and review boundaries.

**Exit evidence:** Clean status from a fresh clone, archive-to-repo file manifest reviewed, accepted baseline PNGs unchanged.

## Phase C — Typed template contracts

**Status:** Completed with contract v1 on 2026-08-07. See [`TEMPLATE_CONTRACT.md`](TEMPLATE_CONTRACT.md) and [`PHASE_C_D_RECORD.md`](PHASE_C_D_RECORD.md).

**Objective:** Make the implicit JSON contract explicit and versioned.

**Scope:** Define a minimal JSON Schema and/or checked type contract for Version 1 fields, enums, ranges, unique IDs, path conventions, category/order behavior, and compatibility defaults. Do not introduce a framework or change registry values.

**Risk:** A schema can reject tolerated data or accidentally redefine default behavior.

**Expected outcome:** Template authors receive actionable validation before deployment; all 14 existing entries pass unchanged.

**Exit evidence:** Schema tests prove every existing effective default and all baseline registry entries validate.

## Phase D — Validation

**Status:** Completed with the dependency-free, read-only baseline validator and negative fixtures on 2026-08-07. See [`PHASE_C_D_RECORD.md`](PHASE_C_D_RECORD.md).

**Objective:** Detect broken releases before the browser does.

**Scope:** Add a command that validates JSON/schema, unique IDs, finite/ranged coordinates, positive dimensions, known shapes/alignment/case, category consistency, artwork existence and exact pixel dimensions, font availability declarations, and `_routes.json`. Validate authoring inputs when present. Report rather than silently mutate.

**Risk:** Overly strict rules could block legitimate edge templates; image tooling versions can vary.

**Expected outcome:** Invalid templates/assets fail locally and in CI with precise messages.

**Exit evidence:** Negative fixtures demonstrate each failure; current baseline is clean.

## Phase E — Automated testing

**Status:** Completed on 2026-08-07 with validator, Function-contract, black-box Chromium, responsive/accessibility-smoke, PNG-download, mocked-cutout, and 16-image visual baseline evidence. See [`PHASE_E_RECORD.md`](PHASE_E_RECORD.md).

**Objective:** Protect behavior and visual output.

**Scope:** Add pure-function tests where logic can be extracted without redesign; browser tests for boot, categories, selection, upload, clear, zoom, drag/pinch, cutout success/fallback/failure, long-name wrapping, download names and dimensions; golden or perceptual PNG checks for representative/all templates; 320/390/430 px and desktop accessibility smoke tests; static/API routing checks.

**Risk:** Canvas/font output is platform-sensitive and brittle pixel-perfect comparisons can create noise.

**Expected outcome:** Objective regressions are caught with documented tolerances and a controlled browser/font environment.

**Exit evidence:** CI passes from a fresh clone; tests fail on deliberate geometry, artwork, font, routing, and wrap regressions.

## Phase F — Dependency hardening

**Objective:** Make runtime, tooling, security, and deployment dependencies controlled and reproducible.

**Scope:** Pin Wrangler, Python, Pillow, and NumPy; record supported runtime versions; self-host/checksum fonts and approved IMG.LY code/model if licensing permits; add CSP/security headers; validate cutout types/magic bytes, timeouts, result host/type/size, rate/cost controls; dependency and provider review; privacy-approved logging; edge-cache/versioning strategy.

**Risk:** Self-hosting fonts/models or adding headers can change pixels or block required resources. Provider controls can change failure timing.

**Expected outcome:** Fewer third-party availability/supply-chain surprises, bounded API abuse, documented privacy posture, reproducible tooling.

**Exit evidence:** Baseline visual tests remain within tolerance; CSP has no violations in supported flows; security/privacy review and provider failure tests pass.

## Phase G — Deterministic template generation

**Objective:** Make a new/updated template reproducible from owned sources.

**Scope:** Acquire layered and paired exports; reconcile `build_templates.py` with production paths, JPEG convention, plural categories, and clean output schema; pin image encoders/dependencies; separate diagnostic output from promotable registry; add fixture/checksum tests and an explicit review/promote step. Preserve manual override support for approved exceptions such as Amplified.

**Risk:** Automated detection can infer wrong geometry from anti-aliasing or unrelated design changes; JPEG encoders differ.

**Expected outcome:** The same approved inputs and toolchain produce the same review artifact, and no script overwrites production without review.

**Exit evidence:** Reproduces all expected geometry or records reviewed exceptions; flyer 15 can be generated, validated, and visually approved without source-code reading.

## Phase H — Production deployment

**Objective:** Operate the unchanged product under permanent Viago control.

**Scope:** Protected CI deploys to Viago Cloudflare preview/production; least-privilege secrets; domain/TLS/DNS cutover; atomic/cache-safe releases; smoke tests, monitoring, provider budget alerts, rollback, incident runbook, access review, and former-project retirement.

**Risk:** DNS/edge propagation, mixed cached assets, wrong-account credentials, provider cost/privacy exposure, or insufficient rollback.

**Expected outcome:** Auditable releases, monitored availability, tested rollback, and no operational dependency on the former owner.

**Exit evidence:** Production acceptance checklist signed, repeated-edge verification passes, rollback exercise succeeds, and ownership records are complete.

## Recommended gates and sequencing

Complete A and legal/ownership portions of the takeover immediately. B is required before collaborative development. C and D precede routine template changes. E precedes renderer/interaction hardening. F precedes enabling paid server-side cutout or relying on production at scale. G precedes flyer 15 if the authoring script is to be trusted. H occurs only after ownership, privacy, minimum validation/testing, and deployment controls are accepted.

The architecture review's demonstrated over-drag defect and render-order race may be fixed in a narrowly scoped release after Phase E establishes evidence. They are not permission for broader UX changes.
