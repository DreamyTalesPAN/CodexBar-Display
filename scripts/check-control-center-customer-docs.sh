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
    (
        "apps/control-center/README.md",
        (root / "apps/control-center/README.md").read_text(encoding="utf-8"),
        None,
    ),
    (
        "docs/control-center-customer-readiness.md",
        (root / "docs/control-center-customer-readiness.md").read_text(encoding="utf-8"),
        None,
    ),
    (
        "docs/operator-runbook.md",
        (root / "docs/operator-runbook.md").read_text(encoding="utf-8"),
        None,
    ),
    (
        "docs/vibetv-shopify-theme-shop.md",
        (root / "docs/vibetv-shopify-theme-shop.md").read_text(encoding="utf-8"),
        None,
    ),
]

section_checks = [
    (
        "docs/vibetv-shopify-theme-shop.md Customer Flow",
        (root / "docs/vibetv-shopify-theme-shop.md").read_text(encoding="utf-8"),
        "## Customer Flow",
        "## GitHub Theme Pack Artifacts",
        ["Companion", "bridge", "API", "terminal command"],
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
    "Companion installer assets",
    "For the hosted customer flow, use the macOS Companion API LaunchAgent installer",
    "customer/support release installer",
    "Installer is not ready yet",
    "Mac package pending",
    "signed/notarized Companion packages",
    "signed/notarized Companion PKGs",
    "Companion packages included",
    "Browser talks directly to `http://127.0.0.1:47832`",
]

errors = []
for label, body, stop_marker in checks:
    scanned = body
    if stop_marker and stop_marker in body:
        scanned = body.split(stop_marker, 1)[0]
    for needle in forbidden:
        if needle in scanned:
            errors.append(f"{label}: legacy customer setup copy still present: {needle}")

for label, body, start_marker, end_marker, needles in section_checks:
    if start_marker not in body or end_marker not in body:
        errors.append(f"{label}: expected customer-facing section markers are missing")
        continue
    scanned = body.split(start_marker, 1)[1].split(end_marker, 1)[0]
    for needle in needles:
        if needle in scanned:
            errors.append(f"{label}: customer flow uses internal wording: {needle}")

if errors:
    for error in errors:
        print(f"error: {error}", file=sys.stderr)
    sys.exit(1)

print("Control Center customer docs are app-first")
PY
