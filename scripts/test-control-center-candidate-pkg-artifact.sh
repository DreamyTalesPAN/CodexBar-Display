#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CHECKER="${ROOT}/scripts/check-control-center-candidate-pkg-artifact.sh"
TMP_WORK_DIR="$(mktemp -d "${TMPDIR:-/tmp}/vibetv-candidate-artifact-test.XXXXXX")"

cleanup() {
  rm -rf "$TMP_WORK_DIR"
}

trap cleanup EXIT
trap 'cleanup; exit 130' INT
trap 'cleanup; exit 143' TERM

die() {
  printf 'error: %s\n' "$*" >&2
  exit 1
}

assert_contains() {
  local haystack needle
  haystack="$1"
  needle="$2"
  printf '%s\n' "$haystack" | grep -F "$needle" >/dev/null \
    || die "expected output to contain: ${needle}"
}

write_artifact() {
  local dir version
  dir="$1"
  version="$2"
  mkdir -p "$dir"
  printf 'fake arm64 package %s\n' "$version" \
    > "${dir}/VibeTV-Companion-API-arm64-v${version}.pkg"
  printf 'fake amd64 package %s\n' "$version" \
    > "${dir}/VibeTV-Companion-API-amd64-v${version}.pkg"
  python3 - "$dir" "$version" <<'PY'
import hashlib
import sys
from pathlib import Path

root = Path(sys.argv[1])
version = sys.argv[2]
names = [
    f"VibeTV-Companion-API-amd64-v{version}.pkg",
    f"VibeTV-Companion-API-arm64-v{version}.pkg",
]
with (root / f"checksums-v{version}.txt").open("w", encoding="utf-8") as out:
    for name in names:
        digest = hashlib.sha256((root / name).read_bytes()).hexdigest()
        out.write(f"{digest}  {name}\n")
PY
}

expect_success() {
  local dir output
  dir="${TMP_WORK_DIR}/complete"
  write_artifact "$dir" "1.2.3"
  output="$("$CHECKER" --artifact-dir "$dir" --version v1.2.3)"
  assert_contains "$output" "candidate package artifact ok: v1.2.3"
  assert_contains "$output" "VibeTV-Companion-API-amd64-v1.2.3.pkg"
  assert_contains "$output" "VibeTV-Companion-API-arm64-v1.2.3.pkg"
}

expect_missing_package_failure() {
  local dir output status
  dir="${TMP_WORK_DIR}/missing"
  write_artifact "$dir" "1.2.3"
  rm "${dir}/VibeTV-Companion-API-arm64-v1.2.3.pkg"
  set +e
  output="$("$CHECKER" "$dir" --version 1.2.3 2>&1)"
  status="$?"
  set -e
  [[ "$status" -ne 0 ]] || die "expected missing package to fail"
  assert_contains "$output" "missing package files: VibeTV-Companion-API-arm64-v1.2.3.pkg"
}

expect_checksum_failure() {
  local dir output status
  dir="${TMP_WORK_DIR}/checksum"
  write_artifact "$dir" "1.2.3"
  printf 'tampered\n' >> "${dir}/VibeTV-Companion-API-amd64-v1.2.3.pkg"
  set +e
  output="$("$CHECKER" --artifact-dir "$dir" --version 1.2.3 2>&1)"
  status="$?"
  set -e
  [[ "$status" -ne 0 ]] || die "expected checksum mismatch to fail"
  assert_contains "$output" "checksum mismatch for VibeTV-Companion-API-amd64-v1.2.3.pkg"
}

expect_wrong_version_failure() {
  local dir output status
  dir="${TMP_WORK_DIR}/wrong-version"
  write_artifact "$dir" "1.2.3"
  set +e
  output="$("$CHECKER" --artifact-dir "$dir" --version 1.2.4 2>&1)"
  status="$?"
  set -e
  [[ "$status" -ne 0 ]] || die "expected wrong version to fail"
  assert_contains "$output" "missing checksum file: checksums-v1.2.4.txt"
  assert_contains "$output" "unexpected package files: VibeTV-Companion-API-amd64-v1.2.3.pkg"
}

expect_success
expect_missing_package_failure
expect_checksum_failure
expect_wrong_version_failure

printf 'control-center candidate package artifact tests passed\n'
