#!/usr/bin/env python3
"""Negative fixtures for the read-only baseline validator."""

from __future__ import annotations

import copy
import json
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
VALIDATOR = ROOT / "tools/validate_baseline.py"
CASES = json.loads((ROOT / "tests/fixtures/negative-cases.json").read_text(encoding="utf-8"))


class ValidatorFixtures(unittest.TestCase):
    maxDiff = None

    def make_root(self) -> tuple[tempfile.TemporaryDirectory, Path]:
        temporary = tempfile.TemporaryDirectory(prefix="viago-validator-")
        root = Path(temporary.name)
        shutil.copytree(ROOT / "public", root / "public")
        (root / "docs").mkdir()
        shutil.copy2(ROOT / "docs/baseline-manifest.json", root / "docs/baseline-manifest.json")
        (root / "tools").mkdir()
        return temporary, root

    def registry(self, root: Path) -> dict:
        return json.loads((root / "public/templates.json").read_text(encoding="utf-8"))

    def write_registry(self, root: Path, registry: dict) -> None:
        (root / "public/templates.json").write_text(json.dumps(registry), encoding="utf-8")

    def mutate(self, case: str, root: Path) -> None:
        registry = self.registry(root)
        template = registry["templates"][0]
        if case == "duplicate_template_id":
            registry["templates"][1]["id"] = template["id"]
            registry["templates"][1]["art"] = template["art"]
        elif case == "invalid_photo_shape":
            template["photo"]["shape"] = "triangle"
        elif case == "invalid_enum":
            template["name"]["align"] = "justify"
        elif case == "non_finite_geometry":
            template["photo"]["x"] = float("nan")
        elif case == "missing_artwork":
            (root / "public" / template["art"]).unlink()
            return
        elif case == "artwork_dimension_mismatch":
            template["w"] += 1
        elif case == "path_traversal":
            template["art"] = "../secret.jpg"
        elif case == "missing_required_property":
            del template["photo"]
        elif case == "malformed_json":
            (root / "public/templates.json").write_text('{"version": 2,', encoding="utf-8")
            return
        elif case == "unsupported_font_declaration":
            template["name"]["font"] = "Unloaded Font"
        elif case == "broken_routes_behavior":
            (root / "public/_routes.json").write_text(json.dumps({"version": 1, "include": ["/*"], "exclude": []}), encoding="utf-8")
            return
        elif case == "unsupported_template_property":
            template["thumbnail"] = "thumb.jpg"
        else:
            raise AssertionError(f"unknown fixture {case}")
        self.write_registry(root, registry)

    def run_validator(self, root: Path) -> subprocess.CompletedProcess[str]:
        return subprocess.run(
            [sys.executable, str(VALIDATOR), "--root", str(root)],
            text=True,
            capture_output=True,
            check=False,
        )

    def test_production_baseline_passes(self) -> None:
        result = self.run_validator(ROOT)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertIn("PASS contract v1: 14 templates", result.stdout)

    def test_negative_fixtures_fail_actionably(self) -> None:
        for fixture in CASES:
            with self.subTest(fixture=fixture["name"]):
                temporary, root = self.make_root()
                try:
                    self.mutate(fixture["name"], root)
                    result = self.run_validator(root)
                    output = result.stdout + result.stderr
                    self.assertNotEqual(result.returncode, 0, output)
                    self.assertIn(fixture["expected"], output)
                    self.assertIn("FAIL contract v1", output)
                finally:
                    temporary.cleanup()


if __name__ == "__main__":
    unittest.main()
