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

  local release_job pkg_job release_count validate_line upload_line download_line checksum_line release_line
  release_job="$(job_block "build-and-release")"
  pkg_job="$(job_block "build-companion-pkgs")"

  assert_contains "$release_job" "needs: build-companion-pkgs" \
    "build-and-release must wait for validated Mac App PKGs before creating the release"
  assert_contains "$release_job" "uses: actions/download-artifact@v4" \
    "build-and-release must download the validated Mac App PKG artifact"
  assert_contains "$release_job" "name: companion-pkgs" \
    "build-and-release must download the companion-pkgs artifact"
  assert_contains "$release_job" "dist/companion-pkg/*.pkg" \
    "GitHub Release must include the signed Mac App PKG assets"
  assert_contains "$release_job" "Build release checksums" \
    "build-and-release must build checksums after PKGs are available"

  assert_contains "$pkg_job" "needs: customer-package-preflight" \
    "build-companion-pkgs must wait for signing/notarization secret preflight"
  assert_contains "$pkg_job" "uses: actions/upload-artifact@v4" \
    "build-companion-pkgs must upload validated PKGs as an internal artifact"
  assert_contains "$pkg_job" "name: companion-pkgs" \
    "build-companion-pkgs must upload the companion-pkgs artifact"
  assert_contains "$pkg_job" "if-no-files-found: error" \
    "build-companion-pkgs must fail if no PKG files were produced"
  assert_not_contains "$pkg_job" "softprops/action-gh-release" \
    "build-companion-pkgs must not mutate an already-created public release"

  release_count="$(grep -cF "softprops/action-gh-release@v2" "$WORKFLOW")"
  [[ "$release_count" == "1" ]] \
    || die "release workflow must have exactly one public GitHub Release creation step"

  validate_line="$(line_number "Validate signed customer Mac App PKGs")"
  upload_line="$(line_number "Upload validated Mac App PKGs")"
  [[ -n "$validate_line" && -n "$upload_line" ]] \
    || die "release workflow must validate signed PKGs before upload"
  (( validate_line < upload_line )) \
    || die "validated PKGs must be uploaded only after signed/notarized validation"

  download_line="$(line_number "Download validated Mac App PKGs")"
  checksum_line="$(line_number "Build release checksums")"
  release_line="$(line_number "Create GitHub Release")"
  [[ -n "$download_line" && -n "$checksum_line" && -n "$release_line" ]] \
    || die "release workflow must download PKGs, build checksums, then create the release"
  (( download_line < checksum_line && checksum_line < release_line )) \
    || die "release checksums must be built after downloading PKGs and before creating the release"

  printf 'control-center release workflow test passed\n'
}

main "$@"
