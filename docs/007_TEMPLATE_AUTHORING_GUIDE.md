# Template Authoring Guide: Adding Flyer 15

For the permanent operational workflow, authors use the private [Hosted Template Studio](HOSTED_TEMPLATE_STUDIO_ARCHITECTURE.md): a browser-session draft, visual validation, explicit publish confirmation, and one attributed GitHub commit. Canva/Drive remains the editable master source, not a runtime datastore.

## Outcome

Following this guide produces one flattened artwork file plus one reviewed entry in `public/templates.json`. No source-code change is needed when the new flyer fits the existing rectangle/circle photo and name model.

The preferred routine operator workflow is the private Hosted Template Studio described in the [operator guide](PLATFORM_OPERATOR_GUIDE.md). The local [VIAGO Template Studio](TEMPLATE_STUDIO.md), started with `npm run studio`, remains for development and recovery. Both remove the need to calculate normalized geometry by hand while preserving source, review, and validation requirements. Manual editing is an advanced recovery path.

## Before starting

Obtain the layered VIAGO Canva design and permission to export/use it. Do not use the flattened production JPEG as the editable master. Record the designer, Canva URL/design ID, approval date, fonts, and source-owner contact in the template change record.

Decide:

- stable lowercase ID using only letters, digits, and hyphens;
- user-facing label;
- existing or approved new category;
- output dimensions (normally 1080×1080 square or 800×1080 portrait in Version 1);
- rectangular or elliptical photo zone; and
- name placement and maximum line policy.

Avoid changing established output sizes without a publishing requirement. Geometry is normalized, but the pixels and typography are designed for a specific canvas.

## Required artwork

Keep three distinct artifacts:

1. layered Canva source—the maintainable design master;
2. original reference export—with placeholder photo and the literal test name visible; and
3. clean production export—with the photo placeholder and name removed, but everything else identical.

The production file must have the exact pixel size declared by `w` and `h`. Version 1 deploys flattened JPEGs under `public/art/<id>.jpg`. JPEG is appropriate for current photographic backgrounds, but inspect blank photo zones for compression contamination and retain lossless authoring exports.

The photo zone in the clean artwork must be visually suitable for painting the photo *over* it. The runtime does not insert the photo behind a transparent overlay.

## Recommended Canva workflow

1. Duplicate a proven page with the same aspect ratio and photo shape.
2. Set the page to the exact target pixel dimensions.
3. Keep the photo placeholder a distinct, single rectangle or circle. Do not add unrelated edits between reference and clean exports.
4. Create the name using Josefin Sans Bold unless brand approves another web-loadable font. Establish intended case, alignment, maximum width, and one/two-line behavior.
5. Export the reference page as PNG at exactly 1×.
6. Duplicate or hide only the photo placeholder and name text; export the clean page as PNG at the same settings.
7. Export the approved clean artwork as the production JPEG at the exact same dimensions.
8. Archive both PNGs and the Canva source reference. Do not depend on personal Canva ownership.

## Deriving photo and name coordinates

Template coordinates are fractions:

- `x = left / canvas width`
- `y = top / canvas height`
- `w = zone width / canvas width`
- `h = zone height / canvas height`

For the name, `x` is normally the horizontal center. `y` is a baseline, not a box top. `size` is font pixels divided by canvas width. `maxWidth` is allowed line width divided by canvas width.

The supplied `tools/build_templates.py` can diff paired files expected under `tools/canva/` and `tools/clean/`, but it is not currently a one-command production generator: those source folders are absent, it writes `tools/templates.json` rather than `public/templates.json`, emits `.png` artwork paths while production uses `.jpg`, uses singular category metadata inconsistent with production's plural categories, and contains diagnostic underscore fields. Treat it as a geometry assistant. Review and manually transfer the intended values; never overwrite the runtime registry blindly.

The Template Studio provides the normal visual workflow: draw/move/resize the photo region, drag the name anchor and width, inspect the resulting fractions, preview through the production renderer, validate, and prepare a checksum-bound promotion plan. It does not make automated image-diff output authoritative.

`tools/diff_windows.py` is useful for inspecting detected pixel/fraction boxes. A circle is inferred when the changed fill ratio is close to π/4. Detection can be confused by shadows, anti-aliasing, gradients, or any unrelated differences between the two exports.

## Registry contract

Add one object at the intended position in `public/templates.json`:

```json
{
  "id": "new-flyer",
  "label": "New Flyer",
  "category": "General",
  "accent": "#8dfa00",
  "art": "art/new-flyer.jpg",
  "w": 1080,
  "h": 1080,
  "photo": {
    "shape": "rect",
    "x": 0.2,
    "y": 0.3,
    "w": 0.6,
    "h": 0.5
  },
  "name": {
    "x": 0.5,
    "y": 0.82,
    "maxWidth": 0.7,
    "size": 0.05,
    "font": "Josefin Sans",
    "weight": 700,
    "color": "#ffffff",
    "align": "center",
    "case": "upper",
    "wrap": true,
    "maxLines": 2,
    "lineHeight": 1.12,
    "vAlign": "top"
  }
}
```

Field meanings:

- `id`: unique stable machine key; changing it changes filenames and selection identity.
- `label`: chip text.
- `category`: exact, case-sensitive category label. First occurrence controls tab order.
- `accent`: selected-chip accent color; use a valid CSS color.
- `art`: path relative to `public/` and the page.
- `w`, `h`: intrinsic Canvas/export dimensions and exact artwork dimensions.
- `photo.shape`: only `rect` and `circle` are implemented. `circle` is actually an ellipse when `w` and `h` differ.
- photo `x/y/w/h`: normalized bounding box.
- name `x/y`: normalized anchor/baseline.
- `size`: normalized against width.
- `maxWidth`: normalized against width.
- `font`, `weight`, `color`, `align`, `case`: Canvas typography.
- `tracking`: optional em-like multiplier of current font pixels; default 0.02.
- `wrap`: enables word wrapping.
- `maxLines`: desired maximum; the renderer shrinks until the wrapped result fits.
- `lineHeight`: multiplier, default 1.15.
- `vAlign`: `top`, `middle`, or omitted final-baseline behavior.

The Version 1 browser does not perform runtime schema validation, so a bad deployed catalog can still fail boot or render incorrectly. The canonical repository now provides the Phase C/D pre-release command `python3 tools/validate_baseline.py`; it must pass before promotion, but it does not change or validate data inside the deployed browser.

## Registration, category, ordering, and thumbnails

Registration is the act of adding the entry to the `templates` array and adding its artwork. No other index exists.

- Place it where it should appear within its category.
- To preserve current category order, keep all General entries before Ranks, and Ranks before Events.
- A genuinely new category appears at the location of its first template; it requires no JavaScript edit.
- The thumbnail is generated automatically from `art`; verify that CSS cropping still makes the flyer recognizable.

## Verification checklist

Serve the received app through an HTTP server or Cloudflare preview; do not rely only on opening `index.html` as a file because fetch/module behavior differs.

Before asking for promotion, run from the repository root:

```bash
python3 tools/validate_baseline.py
```

When using the Studio, select **Validate template**, download and review its artifact, select **Prepare promotion**, inspect the proposed order and target paths, then type `PROMOTE`. Only the final promotion action may write `public/templates.json` and `public/art/<id>.jpg`.

This read-only command validates the Version 1 contract, artwork dimensions and paths, loaded flyer fonts, Functions-only routing, and baseline inventory. It never promotes suggested geometry or rewrites production data. `tools/build_templates.py` remains a geometry-analysis assistant despite its broad name; its output must be reviewed and transferred explicitly.

- [ ] `templates.json` parses as JSON.
- [ ] `python3 tools/validate_baseline.py` exits zero.
- [ ] ID is unique and artwork path exists with exact dimensions.
- [ ] Category and chip appear in the intended order.
- [ ] Thumbnail is recognizable and label fits.
- [ ] Clean artwork appears before a photo is uploaded.
- [ ] Portrait, landscape, square, and very large photos fill the zone.
- [ ] Drag in all directions and 100%, 200%, and 300% zoom behave as expected.
- [ ] Pinch works on a touch device.
- [ ] One short name aligns to the approved baseline.
- [ ] Long two- and three-word names follow the intended wrap/shrink rule.
- [ ] Narrow glyphs, wide glyphs, punctuation, diacritics, and a non-Latin name have been reviewed for the audience.
- [ ] Font is fully loaded before judging pixels.
- [ ] Download dimensions equal `w × h`, format is PNG, and filename is correct.
- [ ] Preview and downloaded PNG match.
- [ ] Test at 320, 390, and 430 CSS pixels and at desktop width.
- [ ] Existing representative General, Rank, and Event flyers are unchanged.
- [ ] Design/brand owner approved the final PNG, not just the Canva page.

Keep approved fixture inputs and expected PNGs once Phase E testing exists.

## Common mistakes

- Editing the clean export after making the reference export, causing the diff to detect unrelated regions.
- Declaring dimensions that differ from artwork pixels, which stretches the art and invalidates coordinates.
- Expecting the photo to sit behind an overlay; Version 1 paints it on top in a blank zone.
- Using absolute pixels in JSON rather than fractions.
- Treating name `y` as the top of a text box.
- Adding a font without loading it in `index.html`; Canvas then uses fallback metrics.
- Renaming IDs casually; IDs are embedded in exported filenames.
- Running `build_templates.py` and copying its whole output over production.
- Losing the paired exports or leaving the only layered source in a personal Canva account.
- Testing only a short name or centered portrait.
- Forgetting that array order controls tabs, chips, and the default flyer.
