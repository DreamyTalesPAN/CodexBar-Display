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

input_block() {
  local input="$1"
  awk -v input="$input" '
    $0 == "      " input ":" { in_input = 1; print; next }
    in_input && $0 ~ /^      [A-Za-z0-9_-]+:/ { exit }
    in_input && $0 ~ /^[^ ]/ { exit }
    in_input { print }
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

main() {
  [[ -f "$WORKFLOW" ]] || die "release workflow is missing"
  local workflow preflight publish verify
  workflow="$(cat "$WORKFLOW")"
  preflight="$(job_block preflight)"
  publish="$(job_block publish-release)"
  verify="$(job_block verify-public-release)"

  assert_contains "$workflow" "name: CODEX Publish VibeTV Release" \
    "publish workflow must use the CODEX release name"
  assert_contains "$workflow" "workflow_dispatch:" \
    "publish workflow must be manually dispatched"
  assert_not_contains "$workflow" "push:" \
    "a pushed tag or branch must never trigger publication"
  for input in version candidate_run_id hardware_canary_run_id; do
    local block
    block="$(input_block "$input")"
    assert_contains "$block" "required: true" \
      "input ${input} must be required"
    assert_contains "$block" "type: string" \
      "input ${input} must use an explicit string contract"
  done

  assert_contains "$workflow" "contents: read" \
    "workflow default permissions must be read-only"
  assert_contains "$workflow" "actions: read" \
    "preflight needs read-only Actions access"
  assert_not_contains "$preflight" "contents: write" \
    "preflight must not receive repository write access"
  assert_contains "$preflight" "github.ref == 'refs/heads/main'" \
    "preflight must run from trusted main"
  assert_contains "$preflight" "gh run download" \
    "preflight must download evidence by run id"
  for artifact in \
    vibetv-release-candidate \
    vibetv-release-candidate-result \
    vibetv-hardware-canary
  do
    assert_contains "$preflight" "--name ${artifact}" \
      "preflight must download ${artifact}"
  done
  assert_contains "$preflight" ".github/workflows/vibetv-release-candidate.yml" \
    "preflight must bind the candidate run to its trusted workflow"
  assert_contains "$preflight" ".github/workflows/record-hardware-canary.yml" \
    "preflight must bind the hardware run to its trusted workflow"
  assert_contains "$preflight" "validate-release-publish-gate.py preflight" \
    "preflight must use the tested JSON validator"
  assert_contains "$preflight" "git/ref/tags/v" \
    "preflight must reject an existing release tag"
  assert_contains "$preflight" "releases/tags/v" \
    "preflight must reject an existing GitHub Release"
  assert_contains "$preflight" "name: vibetv-validated-publish" \
    "preflight must upload one validated internal publish artifact"

  assert_contains "$publish" "environment: Production" \
    "write access must remain behind Production approval"
  assert_contains "$publish" "contents: write" \
    "publish job alone needs repository write access"
  assert_contains "$publish" "name: vibetv-validated-publish" \
    "publish job must download only the validated internal artifact"
  assert_contains "$publish" "gh release create" \
    "publish job must create the tag and release"
  assert_contains "$publish" '--target "${SOURCE_SHA}"' \
    "release tag must target the validated source SHA"
  assert_contains "$publish" "git/ref/heads/main" \
    "publish job must re-read current main after Production approval"
  assert_contains "$publish" 'CURRENT_MAIN_SHA' \
    "publish job must compare current main with the validated source SHA"
  assert_not_contains "$publish" "actions/checkout" \
    "publish job must not checkout or rebuild source"
  assert_not_contains "$publish" "go build" \
    "publish job must not rebuild Go assets"
  assert_not_contains "$publish" "npm " \
    "publish job must not rebuild web assets"
  assert_not_contains "$publish" "platformio" \
    "publish job must not rebuild firmware"
  assert_not_contains "$publish" "git tag" \
    "publish job must not create an unvalidated local tag"
  assert_not_contains "$publish" "git push" \
    "publish job must not push a manually assembled tag"

  assert_contains "$verify" "needs: publish-release" \
    "public verification must wait for publication"
  assert_contains "$verify" "verify-release-canary.sh" \
    "public verification must reuse the existing release canary"
  assert_not_contains "$verify" "contents: write" \
    "public verification must remain read-only"
  [[ "$(grep -cF "contents: write" "$WORKFLOW")" == "1" ]] \
    || die "only publish-release may receive contents: write"

  [[ "$(grep -cF "gh release create" "$WORKFLOW")" == "1" ]] \
    || die "workflow must contain exactly one release creation command"

  printf 'release publish workflow contract passed\n'
}

main "$@"
