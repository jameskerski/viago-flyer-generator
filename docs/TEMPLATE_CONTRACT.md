# Template Registry Contract v1

## Authority and versioning

`public/templates.json` remains the only runtime catalog and reviewed geometry authority. [`contracts/templates.schema.v1.json`](../contracts/templates.schema.v1.json) describes it; the schema is not runtime input and does not duplicate template values.

Contract version 1 is independent of the registry's existing top-level `version: 2`. A future contract gets a new schema version only when its checked rules change. It must remain backward-compatible with the 14 accepted Version 1 templates and effective renderer defaults unless a separately approved product change authorizes a break.

## Exact registry shape

The top level contains exactly:

- `version`: existing registry format value `2`;
- `source`: non-empty provenance description; and
- `templates`: non-empty ordered array.

Each template contains exactly `id`, `label`, `category`, `accent`, `art`, `w`, `h`, `photo`, and `name`.

`id` is unique lowercase letters/digits separated by hyphens. Label and category are non-empty. Categories are exact and case-sensitive but not restricted to today's General/Ranks/Events. Accent and name color are hex CSS colors. Artwork is same-origin `art/<id>.jpg`; absolute paths, URLs, backslashes, traversal, and mismatched IDs are rejected. Canvas dimensions are positive integers and must equal the JPEG dimensions.

## Geometry

Photo `shape` is `rect` or `circle`; `circle` calls Canvas `ellipse`, so unequal width/height produces an ellipse. Photo `x/y` are finite values in `[0,1]`; `w/h` are finite values in `(0,1]`. The contract does not require `x+w <= 1` or `y+h <= 1`, because Canvas legitimately clips shapes at its edge and the Version 1 renderer does not enforce those sums.

Name `x/y` are finite normalized anchors in `[0,1]`. `maxWidth` and `size` are finite normalized values in `(0,1]`.

## Name fields and defaults

Required fields:

- `x`, `y`, `maxWidth`, `size`;
- non-empty `font` and integer `weight` from 1–1000;
- hex `color`;
- `align`: `left`, `center`, or `right`; and
- `case`: `upper` or `none`. `upper` invokes the explicit uppercase branch; `none` preserves entered case.

Optional compatibility behavior comes directly from `public/app.js`:

| Property | Allowed | Omitted/effective behavior |
|---|---|---|
| `tracking` | finite number | `0.02` through `??` |
| `wrap` | boolean | falsy/disabled |
| `maxLines` | integer ≥ 0 | when wrapping, omitted or `0` resolves to `3` through `||`; ignored when wrap is false |
| `lineHeight` | finite number > 0 | `1.15` through `??` |
| `vAlign` | `top`, `middle`, or omitted | omission treats `y` as the final line baseline and stacks earlier lines upward |

Required properties have no omission default in the contract even where defensive renderer fallbacks exist, because every accepted production entry supplies them and authoring ambiguity is unsafe.

## Ordering semantics

Array order is behavior:

1. category order follows first category occurrence;
2. template/chip order follows array order within each category;
3. the first category is initial;
4. the first template in that category is initial; and
5. selecting a category selects its first template.

Validation preserves and observes this order; it never sorts or rewrites the registry.

## Validation command

```bash
python3 tools/validate_baseline.py
```

It uses only Python's standard library and exits non-zero with template/path/property-specific errors. Missing `tools/canva/` and `tools/clean/` are warnings because those authoring sources were not received; if either appears, both must exist with paired filenames.

Validation proves structural contract compliance, unique IDs, finite/ranged values, safe paths, readable JPEG dimensions, declared Google Font family/weight, exact `_routes.json` behavior, and baseline-manifest reconciliation. It does not prove design quality, visual pixel output, font rasterization across browsers, interactions, accessibility, privacy, legal rights, authoring-source correctness, Cloudflare configuration, or production readiness. Phase E is reserved for automated browser and visual evidence.

## Promotion rule

Authoring tools may generate suggestions or diagnostics. A maintainer reviews those results, explicitly edits `public/templates.json`, runs validation, performs the authoring guide's visual checks, and obtains approval. No validator or authoring tool silently promotes data.
