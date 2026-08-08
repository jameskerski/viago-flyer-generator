# Release Guidance

The production topology is public Cloudflare Pages from approved Git state plus a separate Cloudflare Access-protected Worker for Hosted Template Studio. See [Hosted Template Studio architecture](HOSTED_TEMPLATE_STUDIO_ARCHITECTURE.md). Never include `studio/`, admin APIs, or publishing credentials in the public static deployment.

## Current state

The product and deployment architecture are live. Public production is `https://viago-flyer-generator.pages.dev/`. Private Studio production is `https://viago-template-studio-worker.noisy-bread-8a99.workers.dev/`, protected by Google authentication through Cloudflare Access with an exact `goodlifetrainings.com` email-domain rule. Both deploy from the canonical `main` branch at `https://github.com/jameskerski/viago-flyer-generator`.

## Release discipline

Cloudflare automatically deploys approved `main` changes. Record the exact Git commit, operator, account/project, timestamp, secrets/provider state, and rollback deployment for every authorized release.

Before release:

- install the locked development dependencies with `npm ci` and run `npm run test:all`;
- validate static/runtime file scope and `_routes.json`;
- verify all registry artwork paths and dimensions;
- compare affected PNGs with approved baselines;
- test boot, categories, upload, drag/pinch/zoom, name wrapping, clear, and PNG download;
- test 320, 390, and 430 px widths plus desktop;
- test approved cutout success and fallback paths, or confirm it remains unconfigured;
- verify privacy/security/license gates relevant to the change;
- verify the GitHub App remains repository-only with Contents read/write and Metadata read-only, all three `GITHUB_APP_*` Worker secrets exist, and legacy `GITHUB_TOKEN` remains absent; and
- prepare rollback.

After release, request key static assets repeatedly until Cloudflare edges consistently return the new version, then repeat the production smoke test and monitor Function errors/provider spend. Do not retire a previous deployment until the rollback window closes.

Visual baseline updates require explicit review of every changed PNG under `tests/expected/`. Use `npm run test:visual:update` only for an authorized, understood appearance change, then run `npm run test:visual` again. Phase E comparison permits at most a 0.5% differing-pixel ratio with a per-pixel threshold of 0.15 in the controlled Playwright configuration; dimensions must match exactly.
