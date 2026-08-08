# Product Improvement 001: Photo Rotation

## Result

`PHOTO_ROTATION_ACCEPTED`

Implemented on 2026-08-08 against accepted Template Studio commit `0dbf15079fa709c80286e5f981103897ff425143`.

## User experience

The public generator adds one native **Rotation** range slider directly below **Zoom** in the existing photo tools. It appears only after a photo is loaded, ranges from −180° through +180°, starts at the centered 0° position, displays the current degree value, and retains native range-keyboard behavior. No buttons, rotation gesture, transform panel, modal, cropper, filter, or other image tool was added.

## Placement state and resets

Rotation is per-user uploaded-photo placement state:

```text
place.dx
place.dy
place.zoom
place.rotation
```

It is not template data and `public/templates.json` remains unchanged. Rotation resets to 0° with the existing placement reset boundaries: first upload, replacement upload, direct template selection, category-driven template selection, clear, and re-upload. Changing among original/server-cutout/browser-cutout images preserves the current rotation just as it preserves drag and zoom.

## Canvas geometry

The image is clipped with the existing rectangle or ellipse path. The Canvas origin is translated to the center of the active photo window, then the image is rotated by `place.rotation`; drag offsets, cover scale, and user zoom are composed within that transform. Preview and download continue to use the same Canvas.

For window dimensions `W × H`, source dimensions `Iw × Ih`, and angle `θ`, the exact centered minimum-cover scale is:

```text
max(
  (W·|cos θ| + H·|sin θ|) / Iw,
  (W·|sin θ| + H·|cos θ|) / Ih
)
```

The user zoom multiplier is applied above this scale. This is the inverse-rotated extent required to contain all four target-window corners; it is not an arbitrary overscale. Covering the rectangular window bounds also covers every point in a circle/ellipse clipped inside those bounds.

At 0°, the expression reduces exactly to the accepted calculation `max(W / Iw, H / Ih)`. All 16 pre-existing Phase E visual baselines remain unchanged.

## Test and visual evidence

Deterministic browser coverage verifies positive/negative angles, ±180° boundaries, native keyboard changes, every reset boundary, rotation with zoom and drag, portrait/landscape/square synthetic images, rectangular and elliptical windows, exact centered cover geometry, preview/download PNG equality, background-removal image replacement, and 320/390/430/1280px viewports.

Four targeted rotation baselines were added:

- Club 4, landscape fixture, +30°;
- Welcome, portrait fixture, −30°;
- Silver, square fixture, +45°; and
- Jacksonville (Individual), landscape fixture, −45°.

Final verification results:

- baseline validator: 14 templates passed;
- Python validator fixtures: 2 passed;
- Function contracts: 3 passed;
- browser behavior: 26 passed, with the pre-existing trusted-multitouch test skipped;
- visual regression: 6 passed, protecting the original 16 images plus four targeted rotation images;
- Template Studio: 6 passed; and
- complete suite: 41 passed, with the same pre-existing trusted-multitouch skip, plus validator success.

## Scope integrity

The accepted over-drag behavior remains unchanged: `dx` and `dy` still clamp to ±1, and extreme offsets can expose underlying artwork. Rotation guarantees centered/default coverage but does not redesign drag bounds. The documented asynchronous render-generation race also remains unchanged.

The localhost Template Studio still delegates composition to `public/app.js`, so its production preview consumes the updated renderer at the default 0° placement. The Studio has no rotation template field or authoring control because rotation is user placement state, not template geometry.

No template, category, artwork, filename, background-removal provider, Function, deployment, or framework behavior changed.
