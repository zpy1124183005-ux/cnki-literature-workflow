"""Build the release ZIP from an explicit list; never include local research data."""

import hashlib
import json
import zipfile
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
FILES = [
    "SKILL.md", "README.md", "package.json",
    "docs/doubao-install.md", "docs/capture-and-schema.md",
    "docs/2026-11-06-case-study.md", "browser/collect-stage.js",
    "src/records.mjs", "scripts/export-results.mjs",
    "examples/raw.example.json", "test/records.test.mjs",
]


def build():
    for name in FILES:
        source = ROOT / name
        if not source.is_file() or source.is_symlink():
            raise ValueError(f"Missing or unsupported source: {name}")
    target = ROOT / "dist" / "cnki-literature-workflow.skill.zip"
    target.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(target, "w", compression=zipfile.ZIP_DEFLATED) as bundle:
        for name in FILES:
            bundle.write(ROOT / name, arcname=name)
    with zipfile.ZipFile(target) as bundle:
        assert bundle.testzip() is None
        assert set(bundle.namelist()) == set(FILES)
        assert "SKILL.md" in bundle.namelist()
    digest = hashlib.sha256(target.read_bytes()).hexdigest()
    target.with_suffix(target.suffix + ".sha256").write_text(
        f"{digest}  {target.name}\n", encoding="utf-8"
    )
    version = json.loads((ROOT / "package.json").read_text(encoding="utf-8"))["version"]
    print(json.dumps({"version": version, "path": str(target), "files": len(FILES),
                      "bytes": target.stat().st_size, "sha256": digest}, ensure_ascii=False))


if __name__ == "__main__":
    build()
