#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WORKFLOW="${ROOT}/.github/workflows/control-center-customer-pkg-candidate.yml"
READINESS_DOC="${ROOT}/docs/control-center-customer-readiness.md"
RUNBOOK_DOC="${ROOT}/docs/operator-runbook.md"

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
  [[ -f "$READINESS_DOC" ]] || die "customer readiness doc is missing"
  [[ -f "$RUNBOOK_DOC" ]] || die "operator runbook is missing"

  local workflow readiness_doc runbook_doc validate_line checksum_line upload_line
  workflow="$(<"$WORKFLOW")"
  readiness_doc="$(<"$READINESS_DOC")"
  runbook_doc="$(<"$RUNBOOK_DOC")"

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
  assert_contains "$workflow" "Build package checksums" \
    "candidate package workflow must build package checksums"
  assert_contains "$workflow" "shasum -a 256 *.pkg" \
    "candidate package workflow must checksum every package candidate"
  assert_contains "$workflow" "dist/companion-pkg/checksums-*.txt" \
    "candidate package workflow must upload package checksums"
  assert_contains "$workflow" "if-no-files-found: error" \
    "candidate package workflow must fail if no packages were produced"
  assert_contains "$workflow" "retention-days: 14" \
    "candidate package workflow artifacts must expire automatically"

  validate_line="$(line_number "Validate signed and notarized Mac App packages")"
  checksum_line="$(line_number "Build package checksums")"
  upload_line="$(line_number "Upload signed Mac App package candidate")"
  [[ -n "$validate_line" && -n "$checksum_line" && -n "$upload_line" ]] \
    || die "candidate package workflow must validate and checksum packages before uploading them"
  (( validate_line < checksum_line && checksum_line < upload_line )) \
    || die "candidate package artifacts must be uploaded only after validation and checksums"

  assert_contains "$readiness_doc" "workflow file must already exist on the default branch" \
    "customer readiness doc must explain the default-branch dispatch requirement"
  assert_contains "$readiness_doc" "gh workflow run control-center-customer-pkg-candidate.yml" \
    "customer readiness doc must include the candidate workflow dispatch command"
  assert_contains "$readiness_doc" "--ref <branch>" \
    "customer readiness doc must show running the workflow for a chosen branch"
  assert_contains "$readiness_doc" "-f version=<version>" \
    "customer readiness doc must require an explicit candidate package version"
  assert_contains "$readiness_doc" "check-control-center-candidate-pkg-artifact.sh" \
    "customer readiness doc must include the candidate package artifact checker"
  assert_contains "$readiness_doc" "--installed-package" \
    "customer readiness doc must connect candidate artifacts to Clean-Mac installed-package validation"
  assert_contains "$readiness_doc" "--clean-mac-tested" \
    "customer readiness doc must explain when the manual Clean-Mac gate can be supplied"

  assert_contains "$runbook_doc" "gh workflow run control-center-customer-pkg-candidate.yml --ref <branch> -f version=<version>" \
    "operator runbook must include the exact candidate workflow dispatch command"
  assert_contains "$runbook_doc" "check-control-center-candidate-pkg-artifact.sh --artifact-dir <artifact-dir> --version <version>" \
    "operator runbook must include the candidate package artifact checker command"
  assert_contains "$runbook_doc" "check-control-center-companion-customer-readiness.sh --installed-package --local-companion --expect-version <version>" \
    "operator runbook must include the Clean-Mac installed-package validation command"

  printf 'control-center candidate package workflow test passed\n'
}

main "$@"
