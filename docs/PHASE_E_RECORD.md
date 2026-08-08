# Phase E Record: Automated Baseline and Visual Regression Protection

## Result

`PHASE_E_ACCEPTED`

Phase E adds development/test infrastructure only. No production runtime byte changed.

## Controlled environment

- Recorded locally on 2026-08-07, macOS arm64.
- Node.js `22.23.1`, npm `10.9.8`.
- `@playwright/test` `1.62.1`, exactly pinned by `package.json` and `package-lock.json`.
- Google Chrome for Testing/Chromium `151.0.7922.34`, Playwright revision `1234`.
- Viewport evidence: 320×844, 390×844, 430×844, and 1280×900 CSS pixels at device scale factor 1.
- CI target: pinned GitHub Actions on `ubuntu-24.04`, Node 22.23.1, and the Chromium revision installed by locked Playwright.

The test server binds only to `127.0.0.1`, serves `public/` with no-store caching, rejects traversal, and returns deterministic HTTP 501 for local `/api/*` requests. Tests do not require Cloudflare or a production deployment.

## Commands

```bash
npm ci
npx playwright install chromium
python3 tools/validate_baseline.py
python3 -m unittest discover -s tests -p 'test_*.py' -v
npm run test:function
npm run test:browser
npm run test:visual
npm run test:all
```

`npm run test:visual:update` intentionally rewrites expected images and is for an authorized, reviewed baseline change only.

## Synthetic fixtures

`tests/fixtures/portrait.svg`, `landscape.svg`, and `square.svg` are deterministic, repository-owned geometric images. They contain no personal data and are kept outside `public/art/`.

## Behavioral evidence

- Boot reaches Ready with 14 templates, General and Club 4 initially selected.
- Exact General/Ranks/Events category and template order is asserted; changing category selects its first template.
- Typed name and uploaded photo persist across template changes; placement and zoom reset.
- Empty/short/two-word/long names, uppercase transformation, rank wrapping, and representative General/Event single-line behavior are asserted through captured Canvas paint calls and output changes without modifying `app.js`.
- Upload, replacement, clear, photo tools, and object state are asserted with all three synthetic aspect ratios.
- Drag changes normalized placement; zoom accepts 100–300%; template selection resets both.
- PNG signature, exact 800×1080 and 1080×1080 dimensions, empty-name fallback, slug, and template suffix are parsed from real downloads.
- Cutout tests call no provider: server success, server-error/local-fallback initiation, and total failure/restoration are mocked at network/module boundaries. Direct Function contracts cover missing file (400), no provider (501), and oversize input (413).
- Local static assets remain available while `/api/*` remains isolated; the Phase C/D validator separately protects exact `_routes.json` intent.
- 320/390/430/1280 widths protect horizontal containment, Canvas containment, 44px upload target, 16px name input, hidden photo controls, sticky preview pointer-event behavior, and reachable download.
- Accessibility smoke protects status semantics, labels, keyboard focus/activation of category controls, visible focus outline, keyboard name entry, and primary-control roles. It is not a full WCAG audit. The visually styled file label is not proven as keyboard-operable and remains an accessibility-review item.

## Pinch limitation

Desktop Chromium automation cannot produce trusted multi-touch pointer state. Synthetic PointerEvents fail to establish the native active pointer required by `setPointerCapture`, so the pinch test is explicitly skipped rather than claiming false evidence. Pinch still requires manual real-device coverage or a future trusted mobile automation environment.

## Visual baseline

Sixteen expected PNG screenshots live in `tests/expected/`:

- photo + `Avery Stone` for all 14 templates;
- Club 4 artwork with no photo/name; and
- Silver with portrait fixture and `Alexandria Montgomery Rivera` wrapped across lines.

Exact invariants—registry values, order, filenames, PNG signatures, output dimensions, artwork paths/dimensions, and runtime hashes—are checked separately. Canvas appearance is perceptual because font rasterization varies: Playwright requires equal screenshot dimensions, pixel threshold 0.15, and at most 0.5% differing pixels. This is deliberately narrow and must not be loosened merely to pass.

Visual tests explicitly wait for Josefin Sans Bold through the Font Loading API. They retain the existing Google Fonts network dependency; fallback-font screenshots are not accepted. Self-hosting belongs to Phase F.

## Known accepted defects

1. **Over-drag:** reproduced. With a deterministic landscape fixture, drag reaches the existing `dx = 1` clamp and the calculated drawn-photo bounds no longer cover the entire clipped window. The test freezes that evidence without approving the defect permanently.
2. **Asynchronous render generation race:** reproduced during a clean full-suite run as a prior Rank-name paint arriving after Event selection. Because timing is nondeterministic, the stable name test waits for the existing queue to settle rather than encoding an unreliable expected failure. No fix was introduced.

## CI

`.github/workflows/quality.yml` is a quality gate only. From a clean checkout it runs `npm ci`, installs locked Chromium, validates production data, runs validator negative fixtures, and executes Function, browser, and visual tests. Exact action commits are pinned. Failure traces/screenshots/reports are retained for seven days. CI does not deploy.

## Runtime integrity

The protected files remain byte-identical to the accepted Phase C/D state and original received archive:

- `public/index.html`
- `public/styles.css`
- `public/app.js`
- `public/templates.json`
- `public/art/*`
- `public/_routes.json`
- `functions/api/cutout.js`

## Limits

This suite does not prove cross-browser equivalence, trusted real-device pinch, a full accessibility standard, Cloudflare edge behavior, external-provider correctness, privacy/legal rights, or production ownership. The asynchronous race remains evidence-only. These limits must remain visible when authorizing improvements or later phases.
