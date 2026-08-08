# Received Baseline: Viago Takeover Plan

## Goal

Transfer the received Version 1 product into permanent Viago control without changing behavior, visuals, workflow, or rendering.

## 1. Establish the canonical record

- Preserve the original ZIP read-only and calculate/store its SHA-256 in the transfer record.
- Record received Git HEAD `325eb98`, branch `main`, receipt date, sender, and acceptance authority.
- Create a Viago-owned repository under the appropriate engineering organization.
- Import the received Git history intentionally; do not copy its nested `.git` directory into another repository.
- Protect `main`, require review/status checks when they exist, disable force pushes, and establish CODEOWNERS for runtime, templates/assets, Functions, and deployment.
- Add this documentation package alongside the imported baseline after review. Do not combine the earlier Next.js implementation with the received application.

The current workspace contains a separate earlier implementation and uncommitted changes. Migration must be performed in a clean repository/worktree after those changes are resolved by their owner; this package does not overwrite them.

## 2. Resolve legal and asset ownership

- Identify every contributor and obtain the necessary code copyright assignment or license.
- Obtain written rights to all VIAGO marks, text, photographs/background elements, and template artwork.
- Transfer the Canva design from Matt/personal ownership to a Viago team with at least two administrators.
- Obtain layered source files and paired reference/clean exports for all 14 templates.
- Review Google Fonts licenses, Pillow/NumPy/tool dependencies, `@imgly/background-removal`, fal.ai, Replicate, Cloudflare, and any Canva stock elements.
- Add an approved repository license/notice. Absence of a LICENSE file means rights must not be assumed.
- Store large/layered sources in an approved design/DAM system; store immutable IDs/checksums and export instructions in the repository.

This is a production gate, not housekeeping.

## 3. Transfer operational ownership

- Create a Viago Cloudflare account/project or use the approved corporate account.
- Use role-based access, SSO/MFA, two break-glass admins, least-privilege CI credentials, and an access review schedule.
- Deploy the unmodified received `public/` plus `functions/` to a temporary Viago Pages URL.
- Decide whether background removal is approved. If not, configure no provider secret and document the local fallback/visible toggle decision. If approved, establish Viago provider accounts, DPA/privacy approval, quotas, alerts, and rotated secrets.
- Never migrate the former owner's API keys. The received archive states they are not included.
- Preserve `_routes.json` and verify API/static routing.
- Add availability monitoring, privacy-safe client error reporting, Function error/latency metrics, and provider cost alerts.
- Document rollback to the previous Pages deployment.

## 4. Branding transfer

Inventory separately:

- UI title, description, Recognition Studio mark, theme colors, and footer;
- VIAGO names/logos baked into 14 artworks;
- domain, social-preview metadata, and operational sender/contacts; and
- README/HANDOFF references to Matt and the former live project.

For the first takeover deployment, preserve UI and outputs exactly. Make corporate/legal text updates only after acceptance and regression capture; artwork branding changes require layered source re-export and design approval. Do not use takeover as a redesign opportunity.

## 5. Domain migration

1. Select the Viago-owned production hostname and confirm trademark/privacy/security requirements.
2. Reduce DNS TTL in advance if applicable.
3. Configure custom domain and TLS on the Viago Pages project.
4. Validate the temporary deployment repeatedly across Cloudflare edges.
5. Run acceptance: all categories/templates load, upload, drag/pinch/zoom, short/long names, PNG dimensions/filenames, mobile widths, and approved cutout paths.
6. Point DNS to Viago hosting during a staffed window.
7. Monitor static/API errors, certificate, downloads, and provider spend.
8. Keep the former project available for a defined rollback window; then redirect or retire it with written former-owner confirmation.

Do not retire Matt's project until Viago DNS, hosting, secrets, monitoring, and rollback are verified.

## 6. Ownership model

| Area | Accountable owner | Working owner | Approval |
|---|---|---|---|
| Product scope/workflow | Product | Product + engineering | Product |
| Runtime/rendering | Engineering | Web engineering | Code owner + visual regression |
| Templates/coordinates | Brand/design | Trained template administrator | Brand + engineering verification |
| Layered assets/Canva | Brand/design operations | Design team | Brand/legal |
| Cloudflare/domain/DNS | Platform engineering | Platform/SRE | Change management |
| Cutout/privacy | Privacy/security | Platform engineering | Legal/privacy/security |
| Provider spend/secrets | Engineering operations | Platform/SRE | Budget owner |
| Documentation | Engineering | Feature/template change author | Relevant code owner |

Documentation is part of the definition of done. Any template property, authoring procedure, provider, deployment, or protected gotcha change must update the corresponding guide in the same pull request.

## 7. Acceptance and closure

- [ ] Original archive/checksum and commit recorded.
- [ ] Viago repository and ownership controls established.
- [ ] Rights, license, Canva, stock assets, and layered sources documented.
- [ ] Viago Cloudflare project deployed from a controlled identity.
- [ ] Domain/TLS/DNS owned by Viago.
- [ ] Cutout disabled or fully privacy/security/cost approved.
- [ ] Secrets are Viago-owned and former credentials absent.
- [ ] All 14 templates pass signed acceptance PNGs.
- [ ] Mobile/desktop and routing checks pass.
- [ ] Monitoring, alerts, rollback, incident contact, and runbook exist.
- [ ] Former project retired only after rollback window.
- [ ] Matt/former owner is removed from operational dependencies.
- [ ] Template and documentation owners have accepted ongoing responsibility.

