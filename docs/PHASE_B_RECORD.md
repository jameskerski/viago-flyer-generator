# Phase B Record: Canonical Repository Establishment

## Result

`PHASE_B_ACCEPTED` for repository normalization. Ownership, licensing, Canva/source, Cloudflare, and provider/privacy gates remain unresolved and must be closed before permanent production takeover.

## Original source

- Archive: `/Users/jameskerski/Desktop/viago-flyers.zip`
- Verified SHA-256: `2d3125244744c4a7d539b4d714be22301af398b599253c8a4081e722b595bf1d`
- Received branch/HEAD: `main` at `325eb98db23bdebd33bb92bf6b77c67ad72530de`
- Receipt date recorded by the work package: 2026-08-07

## Canonical repository

- Location: `/Users/jameskerski/Documents/ChatGPT/FLYER GENRATOR/canonical/viago-flyers`
- Branch: `main`
- Remote: none; no Viago repository URL was evidenced or invented
- History handling: the archive was extracted into a temporary directory, its Git object database was checked, and the repository was cloned with `--no-local`. This transferred commits/objects through Git rather than copying a nested `.git` folder. The temporary source remote was then removed.

The separate outer workspace contains the superseded Next.js implementation and unrelated uncommitted user work. It was not reset, stashed, moved, overwritten, or merged.

## Intentionally added or changed

- Added the eight approved Phase A architecture/ownership documents under `docs/`.
- Added `docs/INDEX.md`, this record, a machine-readable manifest, ownership/provenance structure, contribution guidance, and release guidance.
- Added OS transient patterns to `.gitignore`; `.wrangler/` was already ignored.
- Added a canonical-status/navigation notice to `README.md` and changed its live URL description to a historical deployment statement.
- Marked `HANDOFF.md` as historical while retaining its original facts.
- Added navigation to the received-baseline index and recorded Phase B status in the roadmap.

No `LICENSE` or `CODEOWNERS` was added because authority and repository identities are not established by evidence.

## Intentionally excluded

- `.wrangler/cache/pages.json` and all `.wrangler/` state;
- `.DS_Store`, Windows shell artifacts, and AppleDouble files;
- the superseded Next.js implementation and its history/worktree changes;
- temporary archive extraction paths; and
- any inferred Cloudflare account, remote, username, team, secret, or provider owner.

## Behavioral preservation

Authoritative runtime scope:

- `public/index.html`
- `public/styles.css`
- `public/app.js`
- `public/templates.json`
- `public/art/*`
- `public/_routes.json`
- `functions/api/cutout.js`

Phase B introduces zero byte differences in this scope relative to the verified received archive. Repository/governance text only was changed outside the runtime scope.

## Unresolved gates

- code copyright assignment/license;
- artwork, VIAGO mark, stock-element, and font rights;
- Canva/layered source and paired export transfer;
- Viago Cloudflare project/account, custom domain, DNS/TLS, CI and rollback ownership;
- fal.ai/Replicate/IMG.LY privacy, provider-account, secret, quota, and budget ownership; and
- corporate repository remote and CODEOWNERS identities.

## Phase C readiness

The repository is structurally ready for the separately authorized Phase C — Typed Template Contracts. Phase C has not begun. Legal and operational gates remain visible but do not prevent local contract design; any production use remains subject to those gates.
