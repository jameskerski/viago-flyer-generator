# VIAGO Flyer Generator — Final Platform Handoff

This is the permanent operating manual for the VIAGO Flyer Generator. It describes the accepted production architecture and the normal administrator and maintainer procedures as of August 8, 2026.

## Production services

| Surface | URL | Access |
| --- | --- | --- |
| Public Flyer Generator | https://viago-flyer-generator.pages.dev/ | Public, unauthenticated, and embeddable |
| Private Template Studio | https://viago-template-studio-worker.noisy-bread-8a99.workers.dev/ | Google sign-in through Cloudflare Access |
| Canonical GitHub repository | https://github.com/jameskerski/viago-flyer-generator | Published application source of truth; production branch is `main` |

The public generator may be embedded in a normal HTTPS iframe. Preserve download permission and give the iframe enough height for the responsive workflow. Do not apply an authentication gate to the public generator.

## Administrator sign-in

1. Open the private Template Studio URL.
2. Choose **Google — Good Life Trainings** when prompted.
3. Sign in with an individual Google identity whose verified email ends exactly in `@goodlifetrainings.com`.
4. Cloudflare Access admits the user only after Google authentication and the exact domain rule pass.

There is no admin allowlist, shared password, per-user role table, or permissions database. Any successfully authenticated Google user with the exact verified domain may use the Studio. Anonymous users, Gmail accounts, other domains, and look-alike suffixes are denied. The Worker independently verifies the Cloudflare Access JWT and repeats the exact domain check.

## Operator quick-start

### Generate a flyer

1. Open the public generator.
2. Pick one of the 14 flyer templates.
3. Upload the leader photo.
4. Drag, zoom, and rotate the photo as needed.
5. Enter the name.
6. Download the full-resolution PNG.

### Create or update a template

1. Open the private Studio and sign in.
2. Open **Admin Instructions** in the Studio header for the approved, protected guide. It opens in a new tab and preserves the current draft.
3. Choose **New template** or **Existing template**.
4. Upload the approved clean production JPEG.
5. Set the template ID, label, category, and category position.
6. Draw or adjust the photo region and name region visually.
7. Enter source/provenance information. Use `Unknown` when evidence is unavailable; do not invent it.
8. Check the production preview with representative short, two-word, and long names.
9. Select **Validate template**.
10. Generate and review the review artifact and exact promotion plan.
11. Complete the final **Publish template** confirmation.
12. Record the returned Git commit SHA. “Deployment in progress” means Cloudflare still needs to deploy the commit.
13. Wait for the Cloudflare builds to succeed, then smoke-test the live public generator.

All publication writes are server-side. The browser never receives the GitHub credential. Catalog and artwork changes are committed together against the draft's recorded base revision; stale revisions are rejected instead of overwriting newer work.

## Retire a template

Retirement is a normal authenticated Studio operation.

1. Open **Existing template** and choose the exact template.
2. Select **Retire Template**.
3. Review its label, ID, category, artwork path, live-catalog warning, and Git recovery notice.
4. Select **Confirm retirement**.
5. Record the returned commit SHA and wait for deployment.
6. Verify the template disappears from the public generator.

The server rechecks identity and revision, derives the artwork path from the validated ID, validates the remaining catalog, and commits the catalog removal plus any unreferenced artwork deletion atomically. Git history remains recovery.

## Source and storage responsibilities

### Canva / Google Drive

The Viago-controlled Canva/Google Drive master-design folder is the editable source and long-term master archive. It holds layered designs, editable Canva work, approvals, and source-quality exports. Its exact folder URL is intentionally not a runtime dependency and is not stored in this repository.

Cloudflare and the browser do not read Google Drive at runtime. Do not add a Google Drive runtime API, synchronization service, or production source archive.

### GitHub

GitHub is the authoritative **published** application state:

- `public/templates.json` is the ordered production catalog.
- `public/art/*` contains the active flattened production JPEGs.
- application, renderer, Studio, validation, tests, and deployment configuration are versioned with the catalog.
- Git history is the technical rollback record.

The hosted Studio publishes as the GitHub App **VIAGO Template Studio Publisher** (App ID `4530195`, installation ID `152276767`). The App is installed only on `jameskerski/viago-flyer-generator`; its only repository permission is Contents read/write, plus GitHub's mandatory Metadata read-only permission. The Worker creates a short-lived App JWT, exchanges it for a short-lived installation token, and refreshes it server-side before expiry. The browser never receives either credential.

The App private key exists only as the Worker's encrypted `GITHUB_APP_PRIVATE_KEY` secret. `GITHUB_APP_ID` and `GITHUB_APP_INSTALLATION_ID` are also encrypted Worker secrets. The legacy `GITHUB_TOKEN` secret has been removed after successful App-only read and publish verification.

### Cloudflare

Cloudflare is the hosting, deployment, and private-access layer:

- Pages project `viago-flyer-generator` serves the public generator.
- Worker project `viago-template-studio-worker` serves the private Studio and authenticated publishing API.
- Access application `VIAGO Template Studio` protects the Worker's production and preview URLs.
- Access policy `Good Life Trainings Google users` allows only verified emails ending exactly in `goodlifetrainings.com`.
- Google identity provider `Google — Good Life Trainings` performs individual sign-in.

A redundant earlier Pages project named `viago-template-studio` is not the protected production Studio. It should be permanently deleted after explicit deletion approval; do not advertise or use it.

## Accepted architecture

- Public product: static HTML, CSS, browser JavaScript, and Canvas.
- Public hosting: Cloudflare Pages, open to the world and iframe-embeddable.
- Private authoring: the existing visual Template Studio hosted by a Cloudflare Worker.
- Authentication: Cloudflare Access plus Google, exact verified `@goodlifetrainings.com` domain rule.
- Published state: GitHub `main` only.
- Artwork: active flattened JPEG files stored directly in GitHub.
- Drafts: browser/session memory only; closing the Studio can lose unfinished work.
- Publishing: authenticated, optimistic, atomic Git commits with an attributable `Published-by` trailer.
- Recovery: Git revert and Cloudflare redeployment.
- Scale: tens of templates; the current accepted catalog contains 14.

There is no Next.js runtime, database, CMS, Supabase, S3/R2 bucket, object storage, persistent draft service, template-revision UI, Google Drive runtime connection, shared password, or permissions database.

## Background removal status

No Viago-owned paid server-side background-removal provider is configured. `FAL_KEY` and `REPLICATE_API_TOKEN` are intentionally absent. The existing deterministic browser fallback remains available through the accepted IMG.LY-based local flow when server removal is unavailable. This does not block launch.

Before enabling a paid provider, complete privacy/DPA review, configure a Viago-owned provider account, set quotas and budget alerts, add abuse/rate controls, inject the secret only in Cloudflare, and rerun provider success/error/oversize and browser-fallback tests.

## Deployment instructions

### Normal automated deployment

1. Make and review an approved change in the canonical repository.
2. Run `npm ci` when dependencies need installation.
3. Run `npm run test:all`.
4. Commit and push the approved change to `main`.
5. Cloudflare automatically builds from the connected GitHub repository.
6. Confirm the relevant Cloudflare deployment reports success.
7. Smoke-test the live URL and verify repeated requests return the new version.

The private Worker build uses:

```text
Build command: npm run build:studio:hosted
Deploy command: npx wrangler deploy
Configuration: wrangler.jsonc
```

The Worker's non-secret Access and repository settings are declared in `wrangler.jsonc`. The GitHub App ID, installation ID, and one-line base64 PKCS#8 private key remain encrypted Cloudflare secrets and must never be committed or exposed to browser code.

### Local review

```text
PUBLIC GENERATOR
npm run app
http://127.0.0.1:4173/

TEMPLATE STUDIO
npm run studio
http://127.0.0.1:4173/studio/
```

Never review through `file://`; ES-module, fetch, and `templates.json` behavior differs from HTTP and can make the static shell look like an empty application.

### Manual deployment fallback

Manual deployment is for an authorized technical maintainer authenticated to the correct Good Life Trainings Cloudflare account:

```bash
npx wrangler pages deploy public --project-name viago-flyer-generator --branch main
npm run deploy:studio:hosted
```

After a manual deployment, confirm the account, project, commit, timestamp, secrets state, and rollback version. Never create a second server implementation or parallel source of truth.

## Recovery and rollback

### Bad template publication

1. Identify the publication commit from the Studio result or Git history.
2. Revert that commit; do not repair only the catalog or only the artwork.
3. Run `npm run test:all` on the reverted state.
4. Push the revert to `main`.
5. Wait for Cloudflare to redeploy.
6. Verify every category plus upload, placement, rotation, name rendering, and PNG download in production.

### Failed or unhealthy deployment

1. Do not publish another template while state is uncertain.
2. Inspect the Cloudflare Pages or Worker build tied to the Git commit.
3. If the commit is bad, revert it in GitHub and allow automatic redeployment.
4. If the commit is good but the new Cloudflare version is unhealthy, use Cloudflare deployment history to roll back to the last known-good version, then investigate before promoting again.
5. Confirm the public generator remains open and the private Studio remains Access-protected.

### Authentication or publishing failure

- Confirm the user signed in with an exact `@goodlifetrainings.com` Google identity.
- Confirm the Cloudflare Access application, Google identity provider, and domain policy remain enabled.
- Confirm the Worker's `CF_ACCESS_AUD`, `CF_TEAM_DOMAIN`, and repository variables exist.
- Confirm encrypted secrets `GITHUB_APP_ID`, `GITHUB_APP_INSTALLATION_ID`, and `GITHUB_APP_PRIVATE_KEY` exist; `GITHUB_TOKEN` should remain absent.
- Confirm the GitHub App remains installed only on the canonical repository with Contents read/write and Metadata read-only.
- If the App key is lost or compromised, generate a replacement in GitHub, convert it to PKCS#8, store its one-line base64 value in `GITHUB_APP_PRIVATE_KEY`, verify Studio read and publish/revert, and only then delete the superseded GitHub App key.
- Do not restore a personal access token except as a tightly controlled emergency measure; remove it immediately after App publishing is restored and proven.
- Never copy credentials into browser code, logs, documentation, or Git.

## Required verification

Before and after any production-affecting change, run:

```bash
npm run test:all
```

The accepted complete suite validates the 14-template contract, negative validator fixtures, public browser behavior, local-launch safety, responsive/accessibility smoke checks, iframe embedding, photo lifecycle, rotation, downloads, cutout fallback, Cloudflare Function boundaries, visual baselines, local Studio behavior, and hosted publication security. A trusted real multi-touch pinch test remains skipped in desktop automation and must be covered by real-device review when that interaction changes.

## Outstanding future ideas — not implemented

- Preserve absent optional template fields during Studio updates instead of serializing default values when the contract permits omission.
- Add a custom production domain while retaining the current `pages.dev` and `workers.dev` rollback paths.
- Add uptime/error monitoring, documented incident ownership, and deployment notifications.
- Add protected-branch review rules and CODEOWNERS after responsible GitHub identities are formally chosen.
- Add content-hashed release versioning if mixed Cloudflare edge caches become an observed problem.
- Enable a paid server-side background-removal provider only after privacy, abuse, quota, and budget controls are approved.
- Improve reproducible generation from layered Canva/source exports; visual inference must not become authoritative geometry.
- Delete the redundant public `viago-template-studio` Pages project after explicit permanent-deletion approval.

Do not implement a database, object storage, persistent drafts, CMS, Google Drive runtime API, separate admin roster, or broader GitHub credential to pursue these ideas.

## Ownership summary

- Good Life Trainings owns and administers the Cloudflare account and Google authentication configuration.
- The shared `jameskerski` GitHub account owns the separate canonical VIAGO repository.
- Canva/Google Drive holds editable master designs.
- GitHub holds published catalog/artwork history.
- Cloudflare provides live delivery and Access enforcement.
- Routine administrators use the private Studio to create, edit, publish, and retire templates; technical maintainers own Git rollback, GitHub App key recovery, and deployment recovery.
