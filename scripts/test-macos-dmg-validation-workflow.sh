#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WORKFLOW="${ROOT}/.github/workflows/validate-macos-dmg.yml"
ENCRYPTOR="${ROOT}/scripts/encrypt-macos-dmg-test-artifact.sh"

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

top_level_block() {
  local key="$1"
  awk -v key="$key" '
    $0 == key ":" { in_block = 1; print; next }
    in_block && $0 ~ /^[^[:space:]]/ { exit }
    in_block { print }
  ' "$WORKFLOW"
}

job_block() {
  local job="$1"
  awk -v job="$job" '
    $0 == "  " job ":" { in_job = 1; print; next }
    in_job && $0 ~ /^  [A-Za-z0-9_-]+:/ { exit }
    in_job { print }
  ' "$WORKFLOW"
}

step_block() {
  local step="$1"
  awk -v step="$step" '
    $0 == "      - name: " step { in_step = 1; print; next }
    in_step && $0 ~ /^      - name:/ { exit }
    in_step { print }
  ' "$WORKFLOW"
}

run_block() {
  local step="$1"
  step_block "$step" | awk '
    in_run && $0 == "" { print; next }
    in_run && $0 ~ /^          / { sub(/^          /, ""); print; next }
    in_run { exit }
    $0 == "        run: |" { in_run = 1 }
  '
}

line_number() {
  local needle="$1"
  grep -nF "$needle" "$WORKFLOW" | head -n1 | cut -d: -f1
}

main() {
  [[ -f "$WORKFLOW" ]] || die "macOS DMG validation workflow is missing"
  [[ -x "$ENCRYPTOR" ]] || die "macOS DMG encryption helper is missing or not executable"

  local trigger_block trigger_block_lower permissions_block build_job signing_job
  local checkout_step encrypt_step encrypt_run upload_step summary_step
  local trusted_files_step reverify_step runtime_step runtime_run
  local event_count permissions_count uses_line
  local verifier_line runtime_line evidence_line checkout_line encrypt_line upload_line summary_line
  local actual_encryptor_sha256

  actual_encryptor_sha256="$(shasum -a 256 "$ENCRYPTOR" | awk '{print $1}')"
  [[ "$actual_encryptor_sha256" == "7d9af43633794a50762762fa90bd1d79466bb47adbc5461e2a57645c73bbe3c2" ]] \
    || die "encryption helper changed without updating its reviewed workflow pin"

  trigger_block="$(top_level_block "on")"
  trigger_block_lower="$(printf '%s\n' "$trigger_block" | LC_ALL=C tr '[:upper:]' '[:lower:]')"
  permissions_block="$(top_level_block "permissions")"
  build_job="$(job_block "build-unsigned-macos-app")"
  signing_job="$(job_block "sign-and-notarize-macos-dmg")"
  checkout_step="$(step_block "Checkout current workflow orchestration")"
  encrypt_step="$(step_block "Encrypt signed DMG test artifact")"
  encrypt_run="$(run_block "Encrypt signed DMG test artifact")"
  upload_step="$(step_block "Upload encrypted signed DMG test artifact")"
  summary_step="$(step_block "Record encrypted test artifact evidence")"
  trusted_files_step="$(step_block "Verify trusted signing files")"
  reverify_step="$(step_block "Reverify notarization tools")"
  runtime_step="$(step_block "Validate installed runtime from notarized DMG")"
  runtime_run="$(run_block "Validate installed runtime from notarized DMG")"

  assert_contains "$(cat "$WORKFLOW")" \
    'CODEX_VALIDATION_SOURCE_SHA: "732cb4578508be6353262b8a26e02b5661760c96"' \
    "validation 11 must pin the reviewed source commit"
  assert_contains "$(cat "$WORKFLOW")" \
    'CODEX_VALIDATION_VERSION: "1.0.47"' \
    "validation 11 must use the isolated validation version"
  assert_contains "$trusted_files_step" \
    '416d95644a545c76c2ba8671f8910c5e48f40242a1f58ac35d763a929faedc2f' \
    "runtime validator must be pinned before signing"
  assert_contains "$reverify_step" \
    'scripts/validate-macos-control-center-runtime.sh' \
    "runtime validator must be reverified after the DMG build"
  assert_contains "$runtime_run" \
    'hdiutil attach "dist/macos/VibeTV-Control-Center.dmg"' \
    "runtime validation must mount the notarized DMG"
  assert_contains "$runtime_run" \
    'CODEX_ALLOW_MACOS_RUNTIME_VALIDATION=1' \
    "real runtime validation must use the explicit safety opt-in"
  assert_contains "$runtime_run" \
    './scripts/validate-macos-control-center-runtime.sh \' \
    "workflow must execute the pinned runtime validator"
  assert_contains "$runtime_run" \
    '--app "${mount_dir}/VibeTV Control Center.app"' \
    "runtime validation must use the app inside the notarized DMG"
  assert_contains "$runtime_run" \
    '--expected-version "${CODEX_VALIDATION_VERSION}"' \
    "runtime validation must verify the validation bundle version"
  assert_not_contains "$runtime_run" 'vibetv.local' \
    "runtime validation must not target physical hardware"

  event_count="$(printf '%s\n' "$trigger_block" | grep -Ec '^  [A-Za-z0-9_-]+:')"
  [[ "$event_count" == "1" ]] || die "validation workflow must only use workflow_dispatch"
  assert_contains "$trigger_block" "  workflow_dispatch:" \
    "validation workflow must use workflow_dispatch"
  assert_contains "$trigger_block" "      dmg_recipient_certificate_base64:" \
    "validation workflow must expose the optional public certificate input"
  assert_contains "$trigger_block" "        required: false" \
    "public certificate input must be optional"
  assert_contains "$trigger_block" "        type: string" \
    "public certificate input must be a string"
  assert_contains "$trigger_block" '        default: ""' \
    "public certificate input must default to empty"
  assert_contains "$trigger_block" "PUBLIC RSA certificate" \
    "input description must make its public-only purpose clear"
  assert_not_contains "$trigger_block_lower" "password" \
    "workflow_dispatch must not accept an artifact password"
  assert_not_contains "$trigger_block_lower" "private key" \
    "workflow_dispatch must not accept a private key"

  permissions_count="$(grep -c '^permissions:' "$WORKFLOW")"
  [[ "$permissions_count" == "1" ]] || die "workflow must have exactly one permissions block"
  assert_contains "$permissions_block" "  contents: read" \
    "workflow permissions must remain contents: read"
  assert_not_contains "$permissions_block" "write" \
    "validation workflow must not receive write permissions"
  [[ "$(printf '%s\n' "$permissions_block" | grep -Ec '^  [A-Za-z0-9_-]+:')" == "1" ]] \
    || die "validation workflow must not receive permissions beyond contents: read"

  for job in "$build_job" "$signing_job"; do
    assert_contains "$job" "github.event_name == 'workflow_dispatch'" \
      "each validation job must enforce workflow_dispatch"
    assert_contains "$job" "github.repository == 'DreamyTalesPAN/CodexBar-Display'" \
      "each validation job must enforce the trusted repository"
    assert_contains "$job" "github.ref == 'refs/heads/main'" \
      "each validation job must enforce main"
    assert_contains "$job" "github.actor == github.repository_owner" \
      "each validation job must enforce the repository owner actor"
    assert_contains "$job" "github.triggering_actor == github.repository_owner" \
      "each validation job must enforce the repository owner triggering actor"
  done

  while IFS= read -r uses_line; do
    [[ "$uses_line" =~ uses:[[:space:]]+[^[:space:]@]+@[0-9a-f]{40}([[:space:]]+#[[:space:]].*)?$ ]] \
      || die "workflow action is not pinned to a full commit SHA: $uses_line"
  done < <(grep -E '^[[:space:]]+uses:' "$WORKFLOW")

  assert_contains "$checkout_step" "inputs.dmg_recipient_certificate_base64 != ''" \
    "orchestration checkout must require a recipient certificate"
  assert_contains "$checkout_step" 'ref: ${{ github.sha }}' \
    "orchestration checkout must use the dispatched workflow commit"
  assert_contains "$checkout_step" "path: tmp/workflow-orchestration" \
    "orchestration checkout must remain isolated"
  assert_contains "$checkout_step" "persist-credentials: false" \
    "orchestration checkout must not persist credentials"

  assert_contains "$encrypt_step" "inputs.dmg_recipient_certificate_base64 != ''" \
    "encryption must require a recipient certificate"
  assert_contains "$encrypt_step" \
    'CODEX_DMG_RECIPIENT_CERTIFICATE_BASE64: ${{ inputs.dmg_recipient_certificate_base64 }}' \
    "recipient certificate must enter the helper through step env"
  assert_contains "$encrypt_run" '"${orchestration_dir}/scripts/encrypt-macos-dmg-test-artifact.sh"' \
    "workflow must resolve the reviewed encryption helper"
  assert_contains "$encrypt_run" \
    'expected_encryptor_sha256="7d9af43633794a50762762fa90bd1d79466bb47adbc5461e2a57645c73bbe3c2"' \
    "workflow must pin the reviewed encryption helper hash"
  assert_contains "$encrypt_run" 'actual_encryptor_sha256="$(shasum -a 256 "${encryptor}" | awk' \
    "workflow must verify the encryption helper before execution"
  assert_contains "$encrypt_run" '"${encryptor}" \' \
    "workflow must only execute the hash-verified encryption helper"
  assert_contains "$encrypt_run" '--dmg "dist/macos/VibeTV-Control-Center.dmg"' \
    "encryption helper must receive the signed DMG"
  assert_contains "$encrypt_run" '--output-dir "tmp/macos-validation/encrypted-artifact"' \
    "encryption helper must write to the isolated artifact directory"
  assert_not_contains "$encrypt_run" '${{ inputs.' \
    "workflow input must not be interpolated directly into shell code"

  assert_contains "$upload_step" "inputs.dmg_recipient_certificate_base64 != ''" \
    "encrypted artifact upload must require a recipient certificate"
  assert_contains "$upload_step" \
    "uses: actions/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02" \
    "encrypted upload action must remain pinned"
  assert_contains "$upload_step" \
    "path: tmp/macos-validation/encrypted-artifact/VibeTV-Control-Center.dmg.cms" \
    "upload must contain exactly the CMS-wrapped DMG"
  [[ "$(printf '%s\n' "$upload_step" | grep -c '^          path:')" == "1" ]] \
    || die "encrypted upload must contain exactly one path"
  assert_contains "$upload_step" "retention-days: 1" \
    "encrypted artifact retention must remain one day"
  assert_contains "$upload_step" "compression-level: 0" \
    "encrypted artifact must not be recompressed"
  assert_contains "$upload_step" "include-hidden-files: false" \
    "encrypted artifact upload must exclude hidden files"
  assert_contains "$upload_step" "if-no-files-found: error" \
    "encrypted artifact upload must fail closed"
  assert_not_contains "$upload_step" "dist/macos/VibeTV-Control-Center.dmg" \
    "plaintext DMG must never be uploaded"
  assert_not_contains "$upload_step" "notarization-log.json" \
    "notarization log must never be uploaded"
  assert_not_contains "$upload_step" "*" \
    "encrypted upload path must not use a glob"

  assert_contains "$summary_step" \
    'CODEX_ENCRYPTED_ARTIFACT_DIGEST: ${{ steps.upload_encrypted_test_dmg.outputs.artifact-digest }}' \
    "summary must record the upload action digest through step env"
  assert_not_contains "$(run_block "Record encrypted test artifact evidence")" '${{ ' \
    "action outputs must not be interpolated directly into shell code"

  verifier_line="$(line_number "Verify notarized DMG for distribution")"
  runtime_line="$(line_number "Validate installed runtime from notarized DMG")"
  evidence_line="$(line_number "Record validation evidence without publishing the DMG")"
  checkout_line="$(line_number "Checkout current workflow orchestration")"
  encrypt_line="$(line_number "Encrypt signed DMG test artifact")"
  upload_line="$(line_number "Upload encrypted signed DMG test artifact")"
  summary_line="$(line_number "Record encrypted test artifact evidence")"
  [[ -n "$verifier_line" && -n "$runtime_line" && -n "$evidence_line" && -n "$checkout_line" && \
     -n "$encrypt_line" && -n "$upload_line" && -n "$summary_line" ]] \
    || die "validation workflow is missing required ordered steps"
  (( verifier_line < runtime_line && runtime_line < evidence_line && evidence_line < checkout_line && \
     checkout_line < encrypt_line && encrypt_line < upload_line && upload_line < summary_line )) \
    || die "validation evidence, encryption, and upload steps are in an unsafe order"

  [[ "$(grep -cF 'uses: actions/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02' "$WORKFLOW")" == "2" ]] \
    || die "workflow must have exactly one unsigned and one encrypted artifact upload"

  local forbidden
  for forbidden in \
    "contents: write" \
    "actions: write" \
    "softprops/action-gh-release" \
    "actions/create-release" \
    "gh release" \
    "gh workflow run" \
    "git tag" \
    "git push" \
    "refs/tags" \
    "actions/deploy-pages"
  do
    assert_not_contains "$(cat "$WORKFLOW")" "$forbidden" \
      "validation workflow contains forbidden release or deployment capability: $forbidden"
  done

  printf 'macOS DMG validation workflow test passed\n'
}

main "$@"
