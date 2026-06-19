#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

python3 - "$ROOT" <<'PY'
from pathlib import Path
import sys

root = Path(sys.argv[1])

checks = [
    (
        "README.md customer setup",
        (root / "README.md").read_text(encoding="utf-8"),
        "## What This Repo Contains",
    ),
    (
        "docs/customer-setup.md",
        (root / "docs/customer-setup.md").read_text(encoding="utf-8"),
        None,
    ),
]

forbidden = [
    "Copy Mac Setup Command",
    "AI-native path",
    "install.sh | bash",
    "codexbar-display install-update --target",
    "theme-pack install --target",
    "check that the daemon target",
    "setup command",
]

errors = []
for label, body, stop_marker in checks:
    scanned = body
    if stop_marker and stop_marker in body:
        scanned = body.split(stop_marker, 1)[0]
    for needle in forbidden:
        if needle in scanned:
            errors.append(f"{label}: legacy customer setup copy still present: {needle}")

if errors:
    for error in errors:
        print(f"error: {error}", file=sys.stderr)
    sys.exit(1)

print("Control Center customer docs are app-first")
PY
