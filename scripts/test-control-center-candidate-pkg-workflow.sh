#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WORKFLOW="${ROOT}/.github/workflows/control-center-customer-pkg-candidate.yml"

die() {
  printf 'error: %s\n' "$*" >&2
  exit 1
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
  [[ -f "$WORKFLOW" ]] || die "customer package candidate workflow is missing"

  local workflow validate_line upload_line
  workflow="$(<"$WORKFLOW")"

  assert_contains "$workflow" "workflow_dispatch:" \
    "candidate package workflow must be manually triggered"
  assert_contains "$workflow" "version:" \
    "candidate package workflow must require an explicit package version"
  assert_contains "$workflow" "required: true" \
    "candidate package workflow version input must be required"
  assert_contains "$workflow" "permissions:" \
    "candidate package workflow must declare permissions"
  assert_contains "$workflow" "contents: read" \
    "candidate package workflow must be read-only against repository contents"
  assert_not_contains "$workflow" "contents: write" \
    "candidate package workflow must not get release-write permissions"
  assert_not_contains "$workflow" "softprops/action-gh-release" \
    "candidate package workflow must not create or mutate a GitHub Release"
  assert_not_contains "$workflow" "tags:" \
    "candidate package workflow must not run automatically from release tags"

  assert_contains "$workflow" "VIBETV_PKG_CERTIFICATE_BASE64" \
    "candidate package workflow must require the package signing certificate secret"
  assert_contains "$workflow" "VIBETV_PKG_CERTIFICATE_PASSWORD" \
    "candidate package workflow must require the package signing password secret"
  assert_contains "$workflow" "VIBETV_NOTARY_APPLE_ID" \
    "candidate package workflow must require the Apple notarization account secret"
  assert_contains "$workflow" "VIBETV_NOTARY_TEAM_ID" \
    "candidate package workflow must require the Apple notarization team secret"
  assert_contains "$workflow" "VIBETV_NOTARY_APP_SPECIFIC_PASSWORD" \
    "candidate package workflow must require the Apple notarization password secret"
  assert_contains "$workflow" "VIBETV_CANDIDATE_VERSION" \
    "candidate package workflow must normalize the requested package version"

  assert_contains "$workflow" "scripts/build-control-center-companion-pkg.sh" \
    "candidate package workflow must build the same Mac App packages as the release path"
  assert_contains "$workflow" "--require-signed" \
    "candidate package workflow must validate package signing"
  assert_contains "$workflow" "--require-notarized" \
    "candidate package workflow must validate notarization"
  assert_contains "$workflow" "uses: actions/upload-artifact@v4" \
    "candidate package workflow must upload internal package artifacts"
  assert_contains "$workflow" "if-no-files-found: error" \
    "candidate package workflow must fail if no packages were produced"
  assert_contains "$workflow" "retention-days: 14" \
    "candidate package workflow artifacts must expire automatically"

  validate_line="$(line_number "Validate signed and notarized Mac App packages")"
  upload_line="$(line_number "Upload signed Mac App package candidate")"
  [[ -n "$validate_line" && -n "$upload_line" ]] \
    || die "candidate package workflow must validate packages before uploading them"
  (( validate_line < upload_line )) \
    || die "candidate package artifacts must be uploaded only after validation"

  printf 'control-center candidate package workflow test passed\n'
}

main "$@"
