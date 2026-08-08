# Ownership and Provenance Record

## Purpose

This is the evidence structure for permanent Viago ownership. Unknown values remain explicitly unresolved; no usernames, accounts, or rights are inferred.

| Area | Received evidence | Intended accountable owner | Current status | Required evidence |
|---|---|---|---|---|
| Runtime source | Received archive and Git history through `325eb98` | Viago engineering organization | Repository normalized; legal rights unresolved | Contributor list and assignment/license |
| Production artwork | 14 flattened JPEG files | Viago brand/design | Files received; rights/source unresolved | Written artwork/trademark/stock rights and approved inventory |
| Canva/layered designs | README/HANDOFF identify a Canva design owned by Matt | Viago brand/design operations | Not transferred | Team-owned Canva design, two admins, source/export provenance |
| Third-party dependencies | Google Fonts, IMG.LY, fal.ai, Replicate, Cloudflare, Pillow, NumPy, Wrangler | Engineering plus legal/privacy/security as applicable | Terms/licenses not fully evidenced | Approved license/terms/DPA/security review and version inventory |
| Deployment | Historical `viago-flyers.pages.dev`; archive included ignored former-account Wrangler cache | Viago platform engineering | Viago ownership not established | Corporate Cloudflare project, access list, CI identity, domain/TLS/DNS record, rollback owner |
| Cutout providers | Environment-variable integrations; no keys in Git | Viago platform/privacy/budget owner | Accounts, privacy decision, and budget owner unresolved | Corporate accounts, DPA/privacy approval, secrets ownership, quota/alerts |

## License gate

This repository intentionally has no `LICENSE` file. Absence of a license does not grant reuse rights. Do not add a license until Viago has documented authority for code and assets and legal has approved the license text.

## Source-of-truth chain

1. Layered Canva/design source is visual-design authority.
2. A reviewed export becomes the production visual asset.
3. `public/templates.json` is the runtime catalog and geometry authority.
4. `public/app.js` is the shared renderer.
5. Tools produce suggestions/review artifacts only; they do not silently promote data.

For every new template, record design URL/ID, designer, rights/stock review, reference and clean export checksums, approved production-art checksum, registry review, approver, and release.

## CODEOWNERS status

No `CODEOWNERS` file was created in Phase B because no repository usernames or teams were established by evidence. Create it only after corporate identities are known, covering runtime, Functions/deployment, templates/art, and documentation/source provenance separately.
