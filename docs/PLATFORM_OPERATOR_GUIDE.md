# VIAGO platform operator guide

## Public Flyer Generator

Production: `https://viago-flyer-generator.pages.dev/`

The Cloudflare Pages project deploys only `public/` from the canonical repository's `main` branch.

Embed it with a normal iframe whose `src` is that public URL. Give the frame enough height for the responsive workflow and retain browser download permission. The application is deliberately unauthenticated. Its routing does not send `X-Frame-Options` or a restrictive `frame-ancestors` policy, so generic HTTPS embedding remains available.

## Private Template Studio

Production: `https://viago-template-studio-worker.noisy-bread-8a99.workers.dev/`

Sign in through Google using an individual email ending exactly in `@goodlifetrainings.com`. Other domains, anonymous visitors, look-alike suffixes, and empty identities are denied.

Normal workflow:

1. Open **Admin Instructions** in the Studio header for the approved guide. It opens in a new protected tab and preserves the current draft.
2. Choose **New template** or **Existing template**.
3. Upload the approved clean JPEG.
4. Configure the template visually and preview it.
5. Validate, select **Publish**, review the affected catalog/art paths, and confirm.
6. Wait for the GitHub commit identifier. “Deployment in progress” does not mean Cloudflare is live yet.

Retirement is currently a technical-maintainer operation; the live Studio has no retirement control. Follow the approved Admin Instructions and permanent handoff to remove the exact catalog entry and only its unreferenced artwork, validate, commit, deploy, and retain the commit SHA for rollback. Nothing expires automatically.

Drafts live only in the browser session. Closing the editor can lose unfinished work. There is no autosave or drafts database.

## Source storage

Canva/Google Drive holds editable master designs. GitHub holds published runtime state: `public/templates.json`, `public/art/*`, and application code. Cloudflare deploys that Git state. Do not add a production source archive or Drive runtime integration.

## Recovery

Git history is emergency rollback. A technical maintainer reverts the single publication commit and allows Cloudflare to redeploy it. Routine operators do not use Git, JSON, a terminal, or local files.

Publishing uses the **VIAGO Template Studio Publisher** GitHub App (App ID `4530195`, installation ID `152276767`), installed only on `jameskerski/viago-flyer-generator` with Contents read/write and mandatory Metadata read-only. The Worker exchanges an App JWT for short-lived installation tokens and refreshes them server-side. Its App ID, installation ID, and base64 PKCS#8 private key are encrypted Cloudflare secrets; the browser receives none of them. The former `GITHUB_TOKEN` secret is removed.

For recovery, verify the installation and the three `GITHUB_APP_*` secrets. If the private key must be replaced, generate a new App key, convert it to PKCS#8, store its one-line base64 value in Cloudflare, prove read and publish/revert, then delete the superseded App key.

## Background removal

No Viago-owned paid server provider is configured. The existing deterministic browser fallback remains available and launch is not blocked.
