#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WORKFLOW="${ROOT}/.github/workflows/release.yml"

die() {
  printf 'error: %s\n' "$*" >&2
  exit 1
}

job_block() {
  local job="$1"
  awk -v job="$job" '
    $0 == "  " job ":" { in_job = 1; print; next }
    in_job && $0 ~ /^  [A-Za-z0-9_-]+:/ { exit }
    in_job { print }
  ' "$WORKFLOW"
}

assert_contains() {
  local haystack="$1"
  local needle="$2"
  local message="$3"
  [[ "$haystack" == *"$needle"* ]] || die "$message"
}

assert_not_contains() {
  local haystack="$1"
  local needle="$2"
  local message="$3"
  [[ "$haystack" != *"$needle"* ]] || die "$message"
}

line_number() {
  local needle="$1"
  grep -nF "$needle" "$WORKFLOW" | head -n1 | cut -d: -f1
}

main() {
  [[ -f "$WORKFLOW" ]] || die "release workflow is missing"

  local release_job release_count checksum_line release_line
  release_job="$(job_block "build-and-release")"

  assert_contains "$release_job" "Build release checksums" \
    "build-and-release must build release checksums"
  assert_contains "$release_job" "dist/install-control-center-companion.sh" \
    "GitHub Release must include the Terminal setup script"
  assert_contains "$release_job" "dist/companion/*" \
    "GitHub Release must include the Mac companion binaries"
  assert_not_contains "$release_job" "needs: build-companion-pkgs" \
    "build-and-release must not wait for Mac App PKGs"
  assert_not_contains "$release_job" "actions/download-artifact" \
    "build-and-release must not download package artifacts"
  assert_not_contains "$release_job" "companion-pkgs" \
    "build-and-release must not reference package artifacts"
  assert_not_contains "$release_job" "dist/companion-pkg" \
    "GitHub Release must not include Mac App package assets"
  assert_not_contains "$release_job" ".pkg" \
    "GitHub Release must not include Mac App package assets"
  assert_not_contains "$(cat "$WORKFLOW")" "build-companion-pkgs:" \
    "release workflow must not build Mac App packages"

  release_count="$(grep -cF "softprops/action-gh-release@v2" "$WORKFLOW")"
  [[ "$release_count" == "1" ]] \
    || die "release workflow must have exactly one public GitHub Release creation step"

  checksum_line="$(line_number "Build release checksums")"
  release_line="$(line_number "Create GitHub Release")"
  [[ -n "$checksum_line" && -n "$release_line" ]] \
    || die "release workflow must build checksums before creating the release"
  (( checksum_line < release_line )) \
    || die "release checksums must be built before creating the release"

  printf 'control-center release workflow test passed\n'
}

main "$@"
