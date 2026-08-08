#!/usr/bin/env python3
"""Read-only validator for the canonical VIAGO Version 1 template baseline.

Uses only the Python standard library. It intentionally reports contract and
repository errors but never edits the registry, artwork, or runtime files.
"""

from __future__ import annotations

import argparse
import json
import math
import re
import struct
import sys
from pathlib import Path, PurePosixPath
from urllib.parse import parse_qs, unquote, urlparse


CONTRACT_VERSION = 1
REGISTRY_VERSION = 2
TOP_FIELDS = {"version", "source", "templates"}
TEMPLATE_FIELDS = {"id", "label", "category", "accent", "art", "w", "h", "photo", "name"}
PHOTO_FIELDS = {"shape", "x", "y", "w", "h"}
NAME_REQUIRED = {"x", "y", "maxWidth", "size", "font", "weight", "color", "align", "case"}
NAME_OPTIONAL = {"tracking", "wrap", "maxLines", "lineHeight", "vAlign"}
ID_RE = re.compile(r"^[a-z0-9]+(?:-[a-z0-9]+)*$")
COLOR_RE = re.compile(r"^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$")
ART_RE = re.compile(r"^art/([a-z0-9]+(?:-[a-z0-9]+)*)\.jpg$")
FONT_LINK_RE = re.compile(r'href=["\']([^"\']*fonts\.googleapis\.com/css2[^"\']*)["\']', re.I)


class Validation:
    def __init__(self) -> None:
        self.errors: list[str] = []
        self.warnings: list[str] = []

    def error(self, where: str, message: str) -> None:
        self.errors.append(f"{where}: {message}")

    def warn(self, where: str, message: str) -> None:
        self.warnings.append(f"{where}: {message}")


def is_number(value: object) -> bool:
    return not isinstance(value, bool) and isinstance(value, (int, float)) and math.isfinite(value)


def exact_fields(v: Validation, obj: object, where: str, required: set[str], allowed: set[str]) -> bool:
    if not isinstance(obj, dict):
        v.error(where, "must be an object")
        return False
    missing = sorted(required - obj.keys())
    extra = sorted(obj.keys() - allowed)
    for key in missing:
        v.error(f"{where}.{key}", "required property is missing")
    for key in extra:
        v.error(f"{where}.{key}", "unsupported property")
    return not missing


def string(v: Validation, value: object, where: str) -> None:
    if not isinstance(value, str) or not value.strip():
        v.error(where, "must be a non-empty string")


def integer(v: Validation, value: object, where: str, minimum: int = 1, maximum: int | None = None) -> None:
    if isinstance(value, bool) or not isinstance(value, int):
        v.error(where, "must be an integer")
    elif value < minimum or (maximum is not None and value > maximum):
        limit = f"{minimum}..{maximum}" if maximum is not None else f">= {minimum}"
        v.error(where, f"must be {limit}")


def normalized(v: Validation, value: object, where: str, positive: bool = False) -> None:
    if not is_number(value):
        v.error(where, "must be a finite number")
        return
    lower_ok = value > 0 if positive else value >= 0
    if not lower_ok or value > 1:
        interval = "(0, 1]" if positive else "[0, 1]"
        v.error(where, f"must be a normalized value in {interval}")


def positive_number(v: Validation, value: object, where: str) -> None:
    if not is_number(value) or value <= 0:
        v.error(where, "must be a finite number greater than 0")


def validate_name(v: Validation, name: object, where: str) -> None:
    if not exact_fields(v, name, where, NAME_REQUIRED, NAME_REQUIRED | NAME_OPTIONAL):
        return
    assert isinstance(name, dict)
    normalized(v, name.get("x"), f"{where}.x")
    normalized(v, name.get("y"), f"{where}.y")
    normalized(v, name.get("maxWidth"), f"{where}.maxWidth", positive=True)
    normalized(v, name.get("size"), f"{where}.size", positive=True)
    string(v, name.get("font"), f"{where}.font")
    integer(v, name.get("weight"), f"{where}.weight", 1, 1000)
    if not isinstance(name.get("color"), str) or not COLOR_RE.fullmatch(name["color"]):
        v.error(f"{where}.color", "must be a supported hex CSS color")
    if name.get("align") not in {"left", "center", "right"}:
        v.error(f"{where}.align", "must be one of: left, center, right")
    if name.get("case") not in {"upper", "none"}:
        v.error(f"{where}.case", "must be one of: upper, none")
    if "tracking" in name and not is_number(name["tracking"]):
        v.error(f"{where}.tracking", "must be a finite number")
    if "wrap" in name and not isinstance(name["wrap"], bool):
        v.error(f"{where}.wrap", "must be a boolean")
    if "maxLines" in name:
        integer(v, name["maxLines"], f"{where}.maxLines", 0)
    if "lineHeight" in name:
        positive_number(v, name["lineHeight"], f"{where}.lineHeight")
    if "vAlign" in name and name["vAlign"] not in {"top", "middle"}:
        v.error(f"{where}.vAlign", "must be one of: top, middle, or omitted")


def validate_photo(v: Validation, photo: object, where: str) -> None:
    if not exact_fields(v, photo, where, PHOTO_FIELDS, PHOTO_FIELDS):
        return
    assert isinstance(photo, dict)
    if photo.get("shape") not in {"rect", "circle"}:
        v.error(f"{where}.shape", "must be one of: rect, circle")
    normalized(v, photo.get("x"), f"{where}.x")
    normalized(v, photo.get("y"), f"{where}.y")
    normalized(v, photo.get("w"), f"{where}.w", positive=True)
    normalized(v, photo.get("h"), f"{where}.h", positive=True)


def jpeg_size(path: Path) -> tuple[int, int]:
    with path.open("rb") as stream:
        if stream.read(2) != b"\xff\xd8":
            raise ValueError("not a JPEG file")
        while True:
            byte = stream.read(1)
            if not byte:
                raise ValueError("JPEG has no size marker")
            if byte != b"\xff":
                continue
            while byte == b"\xff":
                byte = stream.read(1)
            marker = byte[0]
            if marker in {0xD8, 0xD9} or 0xD0 <= marker <= 0xD7:
                continue
            length_bytes = stream.read(2)
            if len(length_bytes) != 2:
                raise ValueError("truncated JPEG segment")
            length = struct.unpack(">H", length_bytes)[0]
            if length < 2:
                raise ValueError("invalid JPEG segment length")
            if marker in {0xC0, 0xC1, 0xC2, 0xC3, 0xC5, 0xC6, 0xC7, 0xC9, 0xCA, 0xCB, 0xCD, 0xCE, 0xCF}:
                payload = stream.read(5)
                if len(payload) != 5:
                    raise ValueError("truncated JPEG size marker")
                height, width = struct.unpack(">HH", payload[1:5])
                return width, height
            stream.seek(length - 2, 1)


def declared_google_fonts(index_html: str) -> dict[str, set[int] | tuple[int, int]]:
    declared: dict[str, set[int] | tuple[int, int]] = {}
    for href in FONT_LINK_RE.findall(index_html):
        query = parse_qs(urlparse(href.replace("&amp;", "&")).query)
        for family_spec in query.get("family", []):
            decoded = unquote(family_spec).replace("+", " ")
            family, _, axes = decoded.partition(":")
            weights: set[int] = set()
            weight_range: tuple[int, int] | None = None
            if axes.startswith("wght@"):
                for part in axes[5:].split(";"):
                    if ".." in part:
                        low, high = part.split("..", 1)
                        if low.isdigit() and high.isdigit():
                            weight_range = (int(low), int(high))
                    elif part.isdigit():
                        weights.add(int(part))
            declared[family] = weight_range or weights
    return declared


def font_supports(declared: dict[str, set[int] | tuple[int, int]], family: str, weight: int) -> bool:
    spec = declared.get(family)
    if spec is None:
        return False
    if isinstance(spec, tuple):
        return spec[0] <= weight <= spec[1]
    return weight in spec


def safe_art_path(v: Validation, root: Path, template: dict, where: str) -> Path | None:
    art = template.get("art")
    template_id = template.get("id")
    if not isinstance(art, str):
        v.error(f"{where}.art", "must be a string")
        return None
    pure = PurePosixPath(art)
    if pure.is_absolute() or ".." in pure.parts or "." in pure.parts or "://" in art or "\\" in art:
        v.error(f"{where}.art", "must be a safe relative path without traversal, URL, or backslash")
        return None
    match = ART_RE.fullmatch(art)
    if not match:
        v.error(f"{where}.art", "must follow production convention art/<lowercase-id>.jpg")
        return None
    if isinstance(template_id, str) and match.group(1) != template_id:
        v.error(f"{where}.art", f"must be art/{template_id}.jpg to match template id")
    candidate = root / "public" / pure
    try:
        candidate.resolve().relative_to((root / "public").resolve())
    except ValueError:
        v.error(f"{where}.art", "resolves outside public/")
        return None
    return candidate


def validate_registry(v: Validation, root: Path) -> tuple[list[dict], set[str]]:
    path = root / "public/templates.json"
    try:
        data = json.loads(path.read_text(encoding="utf-8"), parse_constant=lambda value: (_ for _ in ()).throw(ValueError(f"non-finite number {value}")))
    except FileNotFoundError:
        v.error("public/templates.json", "file is missing")
        return [], set()
    except (json.JSONDecodeError, UnicodeError, ValueError) as exc:
        v.error("public/templates.json", f"invalid JSON: {exc}")
        return [], set()
    if not exact_fields(v, data, "registry", TOP_FIELDS, TOP_FIELDS):
        return [], set()
    assert isinstance(data, dict)
    if data.get("version") != REGISTRY_VERSION:
        v.error("registry.version", f"must equal received registry version {REGISTRY_VERSION}")
    string(v, data.get("source"), "registry.source")
    templates = data.get("templates")
    if not isinstance(templates, list) or not templates:
        v.error("registry.templates", "must be a non-empty array")
        return [], set()
    seen: set[str] = set()
    ids: set[str] = set()
    for index, template in enumerate(templates):
        fallback = f"index {index}"
        if isinstance(template, dict) and isinstance(template.get("id"), str):
            fallback = template["id"]
        where = f"template[{fallback}]"
        if not exact_fields(v, template, where, TEMPLATE_FIELDS, TEMPLATE_FIELDS):
            continue
        assert isinstance(template, dict)
        template_id = template.get("id")
        if not isinstance(template_id, str) or not ID_RE.fullmatch(template_id):
            v.error(f"{where}.id", "must be lowercase letters/digits separated by single hyphens")
        elif template_id in seen:
            v.error(f"{where}.id", f"duplicate template id '{template_id}'")
        else:
            seen.add(template_id)
            ids.add(template_id)
        string(v, template.get("label"), f"{where}.label")
        string(v, template.get("category"), f"{where}.category")
        if not isinstance(template.get("accent"), str) or not COLOR_RE.fullmatch(template["accent"]):
            v.error(f"{where}.accent", "must be a supported hex CSS color")
        integer(v, template.get("w"), f"{where}.w")
        integer(v, template.get("h"), f"{where}.h")
        validate_photo(v, template.get("photo"), f"{where}.photo")
        validate_name(v, template.get("name"), f"{where}.name")
        art_path = safe_art_path(v, root, template, where)
        if art_path is not None:
            if not art_path.is_file():
                v.error(f"{where}.art", f"referenced artwork does not exist: {art_path.relative_to(root)}")
            else:
                try:
                    width, height = jpeg_size(art_path)
                    if isinstance(template.get("w"), int) and isinstance(template.get("h"), int):
                        expected = (template["w"], template["h"])
                        if (width, height) != expected:
                            v.error(f"{where}.art", f"artwork is {width}x{height}; registry declares {expected[0]}x{expected[1]}")
                except (OSError, ValueError) as exc:
                    v.error(f"{where}.art", f"artwork is not a readable JPEG: {exc}")
    return [t for t in templates if isinstance(t, dict)], ids


def validate_fonts(v: Validation, root: Path, templates: list[dict]) -> None:
    path = root / "public/index.html"
    try:
        declared = declared_google_fonts(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeError) as exc:
        v.error("public/index.html", f"cannot read font declarations: {exc}")
        return
    for template in templates:
        name = template.get("name")
        template_id = template.get("id", "unknown")
        if not isinstance(name, dict):
            continue
        family, weight = name.get("font"), name.get("weight")
        if isinstance(family, str) and isinstance(weight, int) and not font_supports(declared, family, weight):
            v.error(f"template[{template_id}].name.font", f"font family/weight '{family}' {weight} is not loaded by public/index.html")


def validate_routes(v: Validation, root: Path) -> None:
    path = root / "public/_routes.json"
    try:
        routes = json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError:
        v.error("public/_routes.json", "file is missing")
        return
    except (json.JSONDecodeError, UnicodeError) as exc:
        v.error("public/_routes.json", f"invalid JSON: {exc}")
        return
    expected = {"version": 1, "include": ["/api/*"], "exclude": []}
    if routes != expected:
        v.error("public/_routes.json", "must exactly route only /api/* to Functions: expected version=1, include=['/api/*'], exclude=[]")


def validate_manifest(v: Validation, root: Path, ids: set[str]) -> None:
    path = root / "docs/baseline-manifest.json"
    try:
        manifest = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError, UnicodeError) as exc:
        v.error("docs/baseline-manifest.json", f"cannot read valid JSON: {exc}")
        return
    expected_ids = manifest.get("templateIds")
    if not isinstance(expected_ids, list) or not all(isinstance(item, str) for item in expected_ids):
        v.error("docs/baseline-manifest.json.templateIds", "must be an array of strings")
    elif set(expected_ids) != ids:
        missing = sorted(set(expected_ids) - ids)
        extra = sorted(ids - set(expected_ids))
        v.error("docs/baseline-manifest.json.templateIds", f"registry mismatch; missing={missing}, unexpected={extra}")
    if manifest.get("templateCount") != len(ids):
        v.error("docs/baseline-manifest.json.templateCount", f"declares {manifest.get('templateCount')!r}, registry has {len(ids)} unique ids")
    expected_art = manifest.get("artworkFiles")
    if isinstance(expected_art, list):
        actual_art = sorted(str(path.relative_to(root)) for path in (root / "public/art").glob("*") if path.is_file())
        if sorted(expected_art) != actual_art:
            v.error("docs/baseline-manifest.json.artworkFiles", "does not match files under public/art/")
    else:
        v.error("docs/baseline-manifest.json.artworkFiles", "must be an array")


def validate_authoring_inputs(v: Validation, root: Path) -> None:
    original = root / "tools/canva"
    clean = root / "tools/clean"
    if not original.exists() and not clean.exists():
        v.warn("authoring inputs", "tools/canva/ and tools/clean/ are unavailable; production validation continues")
        return
    if not original.is_dir() or not clean.is_dir():
        v.error("authoring inputs", "tools/canva/ and tools/clean/ must either both be directories or both be absent")
        return
    originals = {path.name for path in original.iterdir() if path.is_file()}
    cleans = {path.name for path in clean.iterdir() if path.is_file()}
    if not originals:
        v.error("authoring inputs", "tools/canva/ contains no files")
    if originals != cleans:
        v.error("authoring inputs", f"paired filenames differ; missing clean={sorted(originals-cleans)}, missing original={sorted(cleans-originals)}")


def run(root: Path, *, reconcile_manifest: bool = True) -> Validation:
    v = Validation()
    templates, ids = validate_registry(v, root)
    validate_fonts(v, root, templates)
    validate_routes(v, root)
    if reconcile_manifest:
        validate_manifest(v, root, ids)
    validate_authoring_inputs(v, root)
    return v


def main() -> int:
    parser = argparse.ArgumentParser(description="Validate the read-only VIAGO Version 1 template baseline")
    parser.add_argument("--root", type=Path, default=Path(__file__).resolve().parents[1], help="repository root (defaults to this script's repository)")
    parser.add_argument("--skip-baseline-inventory", action="store_true", help="validate a Studio candidate catalog without requiring the received baseline manifest to match")
    args = parser.parse_args()
    root = args.root.resolve()
    result = run(root, reconcile_manifest=not args.skip_baseline_inventory)
    for warning in sorted(result.warnings):
        print(f"WARNING: {warning}")
    if result.errors:
        for error in sorted(result.errors):
            print(f"ERROR: {error}", file=sys.stderr)
        print(f"FAIL contract v{CONTRACT_VERSION}: {len(result.errors)} error(s)", file=sys.stderr)
        return 1
    try:
        count = len(json.loads((root / "public/templates.json").read_text(encoding="utf-8"))["templates"])
    except Exception:
        count = 0
    print(f"PASS contract v{CONTRACT_VERSION}: {count} templates, artwork, fonts, routing, and baseline inventory validated")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
