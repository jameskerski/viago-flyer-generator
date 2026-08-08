# Hosted Template Studio architecture

## Ownership in plain language

- **Canva / Google Drive** holds VIAGO's long-term editable masters. It is not read at runtime.
- **Hosted Template Studio** is the private, browser-based authoring and publishing tool.
- **GitHub** is the only authoritative published store for `public/templates.json` and `public/art/*`.
- **Cloudflare Pages** deploys approved public Git state as the live generator.
- **Public Generator** remains static, open, embeddable, and unauthenticated.

No database, CMS, object storage, Drive runtime connection, shared mutable store, persistent drafts, or autosave is introduced. Unpublished work exists only in the administrator's browser session and is lost when it closes.

## Deployment and security boundary

The public deployment contains `public/` only. It must not contain `studio/`, `hosted/`, admin APIs, or credentials. The private deployment serves the existing Studio UI plus a minimal authenticated server built around `hosted/api.mjs`, `hosted/publishing-service.mjs`, and `hosted/github-repository.mjs`.

Authentication is an injected server-side adapter. It must verify an individual managed identity and return `{ id, displayName, role: "TEMPLATE_ADMIN" }`. Anonymous requests receive 401 and authenticated non-admins receive 403. A shared password is not supported. The provider cannot be selected until VIAGO identifies its managed identity system and admin accounts.

The GitHub adapter uses a server-side credential and GitHub's Git Data API. Give a GitHub App installation (preferred) repository Contents write access only to the canonical repository. Never put its key, installation token, or another token in browser code. Repository owner, name, branch, and credential are deployment configuration, not source defaults.

## Publish workflow

1. The admin signs in with the single `TEMPLATE_ADMIN` role.
2. Studio reads the catalog and records its Git commit SHA as the draft's base revision.
3. The admin chooses new/existing, uploads an approved JPEG, authors visually, previews through the shared renderer, and validates.
4. Publish shows the exact template, new/update status, category/order, and affected paths. A button confirmation is sufficient; hosted use never requires typed `PROMOTE`.
5. The server re-verifies identity and role, re-reads GitHub, and rejects a stale base revision with instructions to reload and review.
6. It stages the candidate and runs the existing `tools/validate_baseline.py` contract validator.
7. One Git tree and one commit update artwork and catalog atomically. The commit records the admin ID in a `Published-by` trailer.
8. Studio shows the commit SHA and “Published to GitHub; deployment in progress.” It does not claim Cloudflare is live without evidence.

## Retire workflow

The admin chooses the exact template and sees its artwork path. A boolean confirmation is required. The server rechecks authentication and base revision, validates the remaining catalog, and creates one commit removing the catalog entry and its `public/art/<id>.jpg` when no remaining entry references it. There is no automatic expiry. Git history is recovery.

## Concurrency, rollback, and path safety

Every operation is optimistic: the draft's source commit SHA must equal branch head. A mismatch returns a conflict and makes no commit. Roll back by reverting the single Git commit and allowing Cloudflare to redeploy it.

The server writes only generated `public/templates.json` and exact `public/art/<safe-id>.jpg` paths. IDs use an allow-listed syntax, catalog art paths must match IDs, candidates must be valid dimension-matching JPEGs, and arbitrary client paths are never accepted.

## Local versus hosted Studio

`npm run studio` remains the development-only workflow at `http://127.0.0.1:4173/studio/`, including its accepted typed `PROMOTE` filesystem behavior. Hosted use has managed authentication and GitHub commits; it never writes an operator's filesystem.

## Required setup boundary

No Git remote or account configuration is present. A VIAGO owner must provide:

1. canonical GitHub repository owner/name and publishing branch;
2. a narrowly scoped GitHub App installed only on that repository;
3. Cloudflare account, public Pages project, private admin deployment, and Git connection;
4. the managed identity provider, verification values, and individual admins; and
5. private-deployment secret injection for GitHub and identity verification.

Only then should a deployment-specific auth adapter and hosting entrypoint be connected. Do not guess these values.
