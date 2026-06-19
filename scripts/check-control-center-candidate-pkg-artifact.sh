#!/usr/bin/env bash
set -euo pipefail

ARTIFACT_DIR=""
VERSION=""

die() {
  printf 'error: %s\n' "$*" >&2
  exit 1
}

usage() {
  cat <<'EOF'
Usage:
  check-control-center-candidate-pkg-artifact.sh --artifact-dir DIR --version VERSION

Checks a downloaded Control Center Customer Package Candidate artifact.

This script is read-only. It verifies:
  - both Mac App .pkg files for the requested version are present,
  - checksums-v<VERSION>.txt is present,
  - checksum entries exactly match the expected package files,
  - each package file matches its recorded SHA-256.

It does not install packages, start services, discover devices, tag, release, or
touch VibeTV hardware.
EOF
}

parse_args() {
  while [[ $# -gt 0 ]]; do
    case "$1" in
      -h|--help)
        usage
        exit 0
        ;;
      --artifact-dir)
        [[ $# -ge 2 ]] || die "--artifact-dir requires a value"
        ARTIFACT_DIR="$2"
        shift 2
        ;;
      --artifact-dir=*)
        ARTIFACT_DIR="${1#*=}"
        shift
        ;;
      --version)
        [[ $# -ge 2 ]] || die "--version requires a value"
        VERSION="$2"
        shift 2
        ;;
      --version=*)
        VERSION="${1#*=}"
        shift
        ;;
      *)
        if [[ -z "$ARTIFACT_DIR" ]]; then
          ARTIFACT_DIR="$1"
          shift
        else
          die "unknown option: $1"
        fi
        ;;
    esac
  done
}

main() {
  parse_args "$@"

  [[ -n "$ARTIFACT_DIR" ]] || die "--artifact-dir is required"
  [[ -n "$VERSION" ]] || die "--version is required"
  VERSION="${VERSION#v}"
  [[ "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] \
    || die "--version must be x.y.z or vx.y.z, got $VERSION"
  [[ -d "$ARTIFACT_DIR" ]] || die "artifact directory does not exist: $ARTIFACT_DIR"
  command -v python3 >/dev/null 2>&1 || die "python3 is required"

  python3 - "$ARTIFACT_DIR" "$VERSION" <<'PY'
import hashlib
import re
import sys
from pathlib import Path

artifact_dir = Path(sys.argv[1])
version = sys.argv[2]
required = {
    f"VibeTV-Companion-API-arm64-v{version}.pkg",
    f"VibeTV-Companion-API-amd64-v{version}.pkg",
}
checksum_path = artifact_dir / f"checksums-v{version}.txt"
errors = []

if not checksum_path.is_file():
    errors.append(f"missing checksum file: {checksum_path.name}")

packages = sorted(path.name for path in artifact_dir.glob("*.pkg"))
package_set = set(packages)
missing_packages = sorted(required - package_set)
extra_packages = sorted(package_set - required)
if missing_packages:
    errors.append("missing package files: " + ", ".join(missing_packages))
if extra_packages:
    errors.append("unexpected package files: " + ", ".join(extra_packages))

entries = {}
if checksum_path.is_file():
    for number, line in enumerate(checksum_path.read_text(encoding="utf-8").splitlines(), start=1):
        stripped = line.strip()
        if not stripped:
            continue
        parts = stripped.split(maxsplit=1)
        if len(parts) != 2:
            errors.append(f"{checksum_path.name}:{number}: expected '<sha256> <filename>'")
            continue
        digest, filename = parts
        filename = filename.strip()
        if filename.startswith("*"):
            filename = filename[1:]
        if "/" in filename or "\\" in filename:
            errors.append(f"{checksum_path.name}:{number}: filename must be local: {filename}")
            continue
        if not re.fullmatch(r"[0-9a-fA-F]{64}", digest):
            errors.append(f"{checksum_path.name}:{number}: invalid SHA-256 digest for {filename}")
            continue
        if filename in entries:
            errors.append(f"{checksum_path.name}:{number}: duplicate checksum entry for {filename}")
            continue
        entries[filename] = digest.lower()

entry_set = set(entries)
missing_entries = sorted(required - entry_set)
extra_entries = sorted(entry_set - required)
if missing_entries:
    errors.append("missing checksum entries: " + ", ".join(missing_entries))
if extra_entries:
    errors.append("unexpected checksum entries: " + ", ".join(extra_entries))

for filename in sorted(required):
    path = artifact_dir / filename
    expected = entries.get(filename)
    if not path.is_file() or not expected:
        continue
    actual = hashlib.sha256(path.read_bytes()).hexdigest()
    if actual != expected:
        errors.append(f"checksum mismatch for {filename}: expected {expected}, got {actual}")

if errors:
    print("candidate package artifact mismatch: " + "; ".join(errors), file=sys.stderr)
    sys.exit(1)

print(f"candidate package artifact ok: v{version}")
for filename in sorted(required):
    print(f"- {filename}")
PY
}

main "$@"
