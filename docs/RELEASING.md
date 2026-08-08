# Release Guidance

## Current state

Phase B establishes repository ownership structure only. It does not configure Cloudflare or authorize production deployment. Viago Cloudflare, domain, secrets, provider approvals, CI identity, and production URL remain unresolved.

## Release discipline

Until Phase H establishes automated deployment, record the exact Git commit, Wrangler version, operator, account/project, timestamp, archive checksum, secrets/provider state, and rollback deployment for every authorized release.

Before release:

- install the locked development dependencies with `npm ci` and run `npm run test:all`;
- validate static/runtime file scope and `_routes.json`;
- verify all registry artwork paths and dimensions;
- compare affected PNGs with approved baselines;
- test boot, categories, upload, drag/pinch/zoom, name wrapping, clear, and PNG download;
- test 320, 390, and 430 px widths plus desktop;
- test approved cutout success and fallback paths, or confirm it remains unconfigured;
- verify privacy/security/license gates relevant to the change; and
- prepare rollback.

After release, request key static assets repeatedly until Cloudflare edges consistently return the new version, then repeat the production smoke test and monitor Function errors/provider spend. Do not retire a previous deployment until the rollback window closes.

Visual baseline updates require explicit review of every changed PNG under `tests/expected/`. Use `npm run test:visual:update` only for an authorized, understood appearance change, then run `npm run test:visual` again. Phase E comparison permits at most a 0.5% differing-pixel ratio with a per-pixel threshold of 0.15 in the controlled Playwright configuration; dimensions must match exactly.
