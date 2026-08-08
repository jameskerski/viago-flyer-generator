# Hosted Template Studio architecture

## Ownership in plain language

- **Canva / Google Drive** holds VIAGO's long-term editable masters. It is not read at runtime.
- **Hosted Template Studio** is the private, browser-based authoring and publishing tool.
- **GitHub** is the only authoritative published store for `public/templates.json` and `public/art/*`.
- **Cloudflare Pages** deploys approved public Git state as the live generator at `https://viago-flyer-generator.pages.dev/`.
- **Cloudflare Workers + Access** deploys the private Studio at `https://viago-template-studio-worker.noisy-bread-8a99.workers.dev/`.
- **Public Generator** remains static, open, embeddable, and unauthenticated.

No database, CMS, object storage, Drive runtime connection, shared mutable store, persistent drafts, or autosave is introduced. Unpublished work exists only in the administrator's browser session and is lost when it closes.

## Deployment and security boundary

The public deployment contains `public/` only. It must not contain `studio/`, `hosted/`, admin APIs, or credentials. The private deployment serves the existing Studio UI plus a minimal authenticated server built around `hosted/api.mjs`, `hosted/publishing-service.mjs`, and `hosted/github-repository.mjs`.

Authentication uses Google identities through Cloudflare Access. Access must use Google as the identity provider and an Allow policy whose email domain is exactly `goodlifetrainings.com`. The server independently verifies the Access JWT and repeats the exact, case-normalized domain check through `hosted/cloudflare-access-auth.mjs`. A match maps to the single internal capability `TEMPLATE_ADMIN`; this is not a roster or role table. Anonymous users and all other domains are denied.

The GitHub adapter uses a server-side fine-grained credential and GitHub's Git Data API. The credential is restricted to the canonical repository with Contents read/write only and is stored only as the Worker's encrypted `GITHUB_TOKEN` secret. Never put the token in browser code. Repository owner, name, branch, Access audience, and team domain are non-secret Worker configuration.

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

## Deployed boundary

The canonical GitHub repository, public Pages project, private Worker, Google identity provider, exact-domain Access policy, audience/team configuration, and encrypted repository-scoped publishing credential are configured. No database, object storage, Drive runtime connection, or persistent draft service exists.
