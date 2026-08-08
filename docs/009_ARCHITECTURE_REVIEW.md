# Received Baseline: Senior Architecture Review

## Executive assessment

The baseline is appropriately small and understandable for its product scope. Its strongest decision is using one full-resolution Canvas as both preview and export, driven by an ordered data registry. The principal production risks are not architectural scale; they are ownership/provenance, absence of automated validation/tests, unpinned delivery/tool dependencies, third-party photo processing, and a few input/resource controls.

Severity definitions: Critical risks can block lawful/safe ownership or expose secrets/data; High risks can cause production outage, privacy impact, or materially wrong exports; Medium risks reduce reliability/maintainability; Low risks are bounded cleanup.

## Strengths

- The system matches its narrow job and avoids unnecessary infrastructure.
- The Canvas provides preview/export parity and deterministic draw order within a browser environment.
- Normalized template geometry supports both square and portrait outputs.
- The registry separates repeated template data from shared rendering behavior.
- Photo object URLs are normally revoked, and working data is session-only.
- Background removal is optional, off by default, and degrades to local processing.
- Provider secrets remain server-side.
- `_routes.json` limits the Function blast radius.
- Pointer input unifies mouse/touch, and mobile tap-size/iOS constraints are documented.
- The unusual wrap-before-shrink behavior and Amplified edit are explained rather than left implicit.
- The received Git history preserves useful intent.

## Findings and recommendations

| Finding | Severity | Why it matters | Recommended fix | Timing |
|---|---|---|---|---|
| Artwork/Canva/code license and assignment are not evidenced in-repo | Critical | Viago cannot claim durable ownership or safely modify/distribute assets without written rights and source access | Obtain signed IP assignment/license, Canva ownership transfer, font/provider license review, and contributor provenance; record artifact inventory | Before production takeover |
| User photos may be sent to fal.ai or Replicate without in-product disclosure/consent | High | Photos can be personal data; provider retention, region, subprocessors, and result URLs are outside this code | Complete privacy/DPA review, add approved notice/consent if required, minimize logs/retention, document provider and local fallback | Before enabling cutout in production |
| No automated tests or release gates | High | A one-file renderer and unvalidated registry can regress all exports silently | Add schema, unit tests, interaction tests, golden PNG tolerances, mobile smoke tests, and CI | Before broad production use |
| Runtime template data is unvalidated | High | Invalid JSON/fields can break boot or silently misrender | Add a versioned typed schema and fail with actionable errors; validate every registry/art pair in CI | Before routine template authoring |
| Unbounded image dimensions/decode work in browser | High | File size alone does not prevent decompression bombs or memory exhaustion; input accepts all `image/*` | Reject unsupported types and extreme pixel counts before heavy processing where possible; test low-memory mobile devices | Before broad/public exposure |
| Cutout Function trusts MIME and buffers/base64-expands full uploads | High | Spoofed/hostile input and multiple copies increase Worker memory/CPU; endpoint can be abused at Viago's cost | Validate magic bytes/types, enforce request/content limits, timeouts and response limits; add rate controls/WAF; avoid data URI where provider supports upload/storage | Before enabling cutout publicly |
| Cutout endpoint lacks authentication/rate limiting | High if enabled, Low if disabled | Any internet client can consume paid provider quota | Cloudflare rate limiting/Turnstile or scoped access consistent with no-account product; budget alerts and provider quotas | Before enabling paid provider |
| Google Fonts and jsDelivr are runtime availability/privacy dependencies | Medium | CSP, outages, regional blocks, or CDN changes can alter/break rendering; font requests disclose client metadata | Self-host approved pinned font files and pinned background-removal assets/model after license review | Before production if pixel consistency/privacy is strict; otherwise Phase F |
| No CSP or explicit security headers | Medium | Third-party scripts/models and future XSS mistakes have broad client capability | Add tested CSP, `X-Content-Type-Options`, `Referrer-Policy`, permissions policy, and framing policy via Cloudflare/static headers | Before production |
| External provider result URL is fetched without allowlisting/size/type controls | Medium | A compromised/malformed provider response can make the Function fetch unexpected resources or stream excessive content | Allowlist HTTPS provider hosts, set timeouts, cap bytes, validate returned content type | Before enabling cutout |
| Asynchronous render requests are not generation-ordered | Medium | Slow artwork load plus rapid selection may allow a stale render to finish last | Add render generation token/abort discipline and interaction regression test | Can wait if field evidence shows no issue |
| Drag permits exposing blank space | Medium objective defect | Cover is valid only at center; offsets clamped to ±1 are not calculated from scaled image margins | Derive per-axis offset bounds from scaled image/window, preserving gestures | Fix before production if reproduced in accepted templates |
| Font rendering is browser/platform dependent | Medium | Canvas glyph metrics/rasterization can make PNGs differ across devices | Self-host fonts, define supported browsers, golden-test with tolerances; consider a controlled export environment only if exact cross-device pixels become a requirement | Can wait for evidence; document now |
| `build_templates.py` does not reproduce production registry as shipped | High maintenance risk | Missing input folders, output path mismatch, `.png` vs `.jpg`, singular vs plural categories, and diagnostics invite destructive replacement | Make generation explicit/deterministic, add fixtures and schema, write to a review artifact, and compare before promotion | Before using it for flyer 15 |
| Authoring source pairs are absent | High maintenance risk | Geometry cannot be regenerated/audited and future work depends on personal Canva access | Transfer layered source plus original/clean exports into controlled asset storage; decide what can legally live in Git/LFS | Before routine maintenance |
| No dependency manifest/lock for Python or Wrangler | Medium | New machines can produce different images/deployments or fail entirely | Pin Python, Pillow, NumPy and Wrangler; record checksums/runtime versions | Before using tools or repeatable production deploys |
| Browser fallback is version-pinned in URL but not integrity-pinned/vendor-controlled | Medium | CDN content/model availability can change; dynamic import cannot use ordinary SRI simply | Vendor and checksum approved artifacts or host them under Viago control | Phase F |
| Direct `npx wrangler` deployment is manual and floating | Medium | Reproducibility, auditability, and wrong-account deployment risk | Pin Wrangler, deploy via protected CI environment, approvals, preview, and rollback | Before permanent production ownership |
| `.wrangler` cache with former account ID is in handoff archive | Low/security hygiene | Discloses account metadata and may confuse operators | Exclude transient directory from future archives; never treat cache as config | Phase B |
| No monitoring, analytics, or error telemetry | Medium | Failures in fonts, assets, Canvas, export, and Function providers may be invisible | Add privacy-minimal availability/error monitoring and provider budget alerts; avoid collecting photos/names | Before production operations |
| Accessibility has partial strengths but no audit | Medium | Status semantics and tap sizes help, but Canvas output, focus visibility/order, contrast, and screen-reader workflow need evidence | Run keyboard/screen-reader/contrast audit and correct objective defects without redesign | Before production |
| Export filename removes non-ASCII names | Medium product correctness/privacy nuance | Many names become `flyer-<id>.png`, reducing usefulness and equitable support | Define an internationalized safe filename policy and tests; do not change until product approves behavior | Can wait; document as known limitation |
| Errors are mostly console/status only | Medium | Failed artwork/render/export can be silent or non-actionable | Add guarded error states, telemetry without user content, and test failure paths | Phase D/E |
| No explicit browser support matrix | Low | Feature fallbacks exist for tracking but not every API | Define supported evergreen browsers/devices and test matrix | Phase A/E |
| Full artwork thumbnails decode all selected-category images | Low/Medium performance | Mobile memory/network grows with template count | Measure first; consider generated thumbnails while retaining full art for Canvas | Can wait; revisit as catalog grows |
| No cache/versioning strategy for static assets | Medium deployment | Edge propagation can mix old JS/JSON/art, producing mismatched geometry | Content-hash/version assets or atomic release paths and set deliberate cache headers | Before reliable production releases |

## Build reproducibility

The static runtime has no build, which is a strength, but the release is not fully reproducible. External fonts and fallback code/model are fetched at runtime; Python dependencies and Wrangler float; authoring inputs are absent; JPEG encoder/tool versions are undocumented; and generation script output does not match production conventions. Record the received archive checksum and commit, then address these gaps without introducing a framework.

## Deployment concerns

The existing live URL is reportedly on the former owner's Cloudflare account. Viago must create its own project, secrets, access groups, custom domain, CI identity, alerting, and rollback process before the former project is retired. DNS cutover must not happen until the Viago deployment passes PNG and cutout checks. Keep `_routes.json` unchanged through the first takeover.

## Production recommendation

Do not redesign or rewrite. Proceed with the received static architecture after resolving rights/source ownership, privacy/provider decisions, Viago-controlled deployment, input/API safeguards, schema validation, and a minimum regression suite. Cutout should remain disabled/unconfigured until its privacy and abuse controls are approved.

