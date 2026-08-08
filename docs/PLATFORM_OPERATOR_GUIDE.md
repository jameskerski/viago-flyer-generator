# VIAGO platform operator guide

## Public Flyer Generator

Production: `https://viago-flyer-generator.pages.dev/`

The Cloudflare Pages project deploys only `public/` from the canonical repository's `main` branch.

Embed it with a normal iframe whose `src` is that public URL. Give the frame enough height for the responsive workflow and retain browser download permission. The application is deliberately unauthenticated. Its routing does not send `X-Frame-Options` or a restrictive `frame-ancestors` policy, so generic HTTPS embedding remains available.

## Private Template Studio

Production: `https://viago-template-studio-worker.noisy-bread-8a99.workers.dev/`

Sign in through Google using an individual email ending exactly in `@goodlifetrainings.com`. Other domains, anonymous visitors, look-alike suffixes, and empty identities are denied.

Normal workflow:

1. Choose **New template** or **Existing template**.
2. Upload the approved clean JPEG.
3. Configure the template visually and preview it.
4. Validate, select **Publish**, review the affected catalog/art paths, and confirm.
5. Wait for the GitHub commit identifier. “Deployment in progress” does not mean Cloudflare is live yet.

To retire an event template, select the exact template, review its artwork path, and confirm retirement. The resulting Git commit removes the catalog entry and unreferenced active artwork. Nothing expires automatically.

Drafts live only in the browser session. Closing the editor can lose unfinished work. There is no autosave or drafts database.

## Source storage

Canva/Google Drive holds editable master designs. GitHub holds published runtime state: `public/templates.json`, `public/art/*`, and application code. Cloudflare deploys that Git state. Do not add a production source archive or Drive runtime integration.

## Recovery

Git history is emergency rollback. A technical maintainer reverts the single publication commit and allows Cloudflare to redeploy it. Routine operators do not use Git, JSON, a terminal, or local files.

The publishing credential is a fine-grained GitHub token restricted to `jameskerski/viago-flyer-generator` with Contents read/write only. It expires September 7, 2026 and must be rotated before expiry in the Worker's encrypted `GITHUB_TOKEN` secret.

## Background removal

No Viago-owned paid server provider is configured. The existing deterministic browser fallback remains available and launch is not blocked.
