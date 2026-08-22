#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CANDIDATE_WORKFLOW="${ROOT}/.github/workflows/vibetv-release-candidate.yml"
PUBLISH_WORKFLOW="${ROOT}/.github/workflows/release.yml"

die() {
  printf 'error: %s\n' "$*" >&2
  exit 1
}

assert_contains() {
  [[ "$1" == *"$2"* ]] || die "$3"
}

assert_not_contains() {
  [[ "$1" != *"$2"* ]] || die "$3"
}

assert_before() {
  local text="$1" first="$2" second="$3" message="$4"
  local prefix="${text%%"$first"*}"
  [[ "$prefix" != "$text" && "$prefix" != *"$second"* ]] || die "$message"
}

main() {
  [[ -f "$CANDIDATE_WORKFLOW" ]] || die "candidate workflow is missing"
  [[ -f "$PUBLISH_WORKFLOW" ]] || die "reusable publish workflow is missing"

  local candidate publish
  candidate="$(cat "$CANDIDATE_WORKFLOW")"
  publish="$(cat "$PUBLISH_WORKFLOW")"

  assert_contains "$candidate" "name: CODEX Prepare and Release VibeTV" \
    "candidate workflow must be the single operator entrypoint"
  assert_contains "$candidate" "workflow_dispatch:" \
    "candidate workflow must remain manually dispatched"
  assert_contains "$candidate" "firmware:" \
    "candidate workflow must choose unchanged or bumped firmware before build"
  assert_contains "$candidate" "options:" \
    "firmware mode must use an explicit choice contract"
  assert_contains "$candidate" "- unchanged" \
    "candidate workflow must support unchanged firmware"
  assert_contains "$candidate" "- bump" \
    "candidate workflow must support patch-bumped firmware"
  assert_contains "$candidate" "uses: ./.github/workflows/release.yml" \
    "successful candidate tests must continue into the reusable publish gate"
  assert_contains "$candidate" "needs: aggregate-result" \
    "publication must wait for the immutable candidate result"
  assert_contains "$candidate" 'select(.type == "required_reviewers")' \
    "candidate preparation must refuse an unprotected Production environment"
  assert_contains "$candidate" "actions: read" \
    "candidate workflow must be allowed to inspect the Production environment"
  assert_contains "$candidate" "current_public.firmware" \
    "unchanged mode must freeze the exact public firmware bytes"
  assert_contains "$candidate" '[[ "$artifact_source" == public ]]' \
    "unchanged mode must copy public firmware instead of rebuilding it"
  assert_contains "$candidate" "public firmware checksum mismatch" \
    "copied public firmware must be verified before candidate packaging"
  assert_contains "$candidate" "retention-days: 30" \
    "candidate artifacts must survive the full approval window"

  assert_contains "$publish" "name: CODEX Publish Prepared VibeTV Candidate" \
    "publish workflow must use the stable CODEX name"
  assert_contains "$publish" "workflow_call:" \
    "publish workflow must only be called by the candidate run"
  assert_not_contains "$publish" "workflow_dispatch:" \
    "publish workflow must not require a second manual dispatch"
  assert_contains "$publish" "environment: Production" \
    "public release must wait for Production approval"
  assert_contains "$publish" "group: codex-vibetv-production-release" \
    "all release versions must share one publication lock"
  assert_contains "$publish" "cancel-in-progress: false" \
    "a later approval must never cancel an active publication"
  assert_contains "$publish" "pattern: vibetv-release-candidate*" \
    "publish gate must consume artifacts from the same workflow run"
  assert_before "$publish" \
    "Checkout the exact candidate source before staging assets" \
    "Download the approved candidate payload" \
    "Production checkout must happen before staging the validated payload"
  assert_contains "$publish" "validate-release-publish-gate.py prepare" \
    "publish gate must validate the immutable candidate and result"
  assert_contains "$publish" "gh release create" \
    "approved candidate must create exactly one GitHub release"
  assert_contains "$publish" '--target "${SOURCE_SHA}"' \
    "release tag must target the candidate source SHA"
  assert_contains "$publish" "releases/latest" \
    "Production approval must reject a candidate older than the current public release"
  assert_contains "$publish" "is no longer newer than public" \
    "stale waiting candidates must fail before changing the latest release"
  assert_contains "$publish" "git/ref/tags/v" \
    "publication must reject an existing tag before creating a release"
  assert_contains "$publish" "releases/tags/v" \
    "publication must reject an existing release before creating a release"
  assert_contains "$publish" "byte-identical to the candidate" \
    "public verification must compare every release asset with the candidate"
  assert_contains "$publish" "verify-release-canary.sh" \
    "public endpoints must be verified after release"
  assert_contains "$publish" "firmware-manifest.json" \
    "public canary must use the candidate's final firmware versions"
  assert_contains "$(cat "$ROOT/scripts/verify-release-canary.sh")" \
    'error: --firmware-config is required' \
    "release canary must never fall back to stale repository firmware versions"
  assert_not_contains "$publish" "hardware_canary" \
    "normal release path must not require separate hardware evidence"
  assert_not_contains "$publish" "git/ref/heads/main" \
    "main moving after candidate creation must not invalidate tested bytes"
  for forbidden in "go build" "npm ci" "pio run" "git tag" "git push"; do
    assert_not_contains "$publish" "$forbidden" \
      "publish workflow must not rebuild or manually push: ${forbidden}"
  done

  [[ "$(grep -cF "contents: write" "$PUBLISH_WORKFLOW")" == "1" ]] \
    || die "only the Production-gated publish job may write repository contents"
  [[ "$(grep -cF "group: codex-vibetv-production-release" "$PUBLISH_WORKFLOW")" == "1" ]] \
    || die "the complete public release and verification path must use one lock"
  [[ "$(grep -cF "gh release create" "$PUBLISH_WORKFLOW")" == "1" ]] \
    || die "workflow must contain exactly one release creation command"

  printf 'release publish workflow contract passed\n'
}

main "$@"
