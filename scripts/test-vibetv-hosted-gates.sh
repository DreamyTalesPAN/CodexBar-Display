#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CI_WORKFLOW="${ROOT}/.github/workflows/ci.yml"
MERGE_WORKFLOW="${ROOT}/.github/workflows/vibetv-merge-gate.yml"
RC_WORKFLOW="${ROOT}/.github/workflows/vibetv-release-candidate.yml"
GATE_REPAIR_WORKFLOW="${ROOT}/.github/workflows/vibetv-gate-repair.yml"
GATE_REPAIR_SCOPE="${ROOT}/scripts/check-vibetv-gate-repair-scope.sh"
EXTRACTOR="${ROOT}/scripts/extract-vibetv-candidate-app.sh"
GUEST_TEST="${ROOT}/scripts/test-vibetv-hosted-guest.sh"
SPARKLE_BUILDER="${ROOT}/scripts/build-sparkle-cli.sh"

die() {
  printf 'error: %s\n' "$*" >&2
  exit 1
}

assert_file() {
  [[ -f "$1" ]] || die "missing required file: $1"
}

assert_contains() {
  local file="$1"
  local needle="$2"
  local message="$3"
  grep -Fq -- "$needle" "$file" || die "$message"
}

assert_not_contains() {
  local file="$1"
  local needle="$2"
  local message="$3"
  ! grep -Fq -- "$needle" "$file" || die "$message"
}

job_block() {
  local workflow="$1"
  local job="$2"
  awk -v job="$job" '
    $0 == "  " job ":" { in_job = 1; print; next }
    in_job && $0 ~ /^  [A-Za-z0-9_-]+:/ { exit }
    in_job { print }
  ' "$workflow"
}

assert_safe_app_extractor() {
  local work
  work="$(mktemp -d "${TMPDIR:-/tmp}/vibetv-hosted-gate.XXXXXX")"
  trap 'rm -rf "${work:-}"' RETURN

  mkdir -p "$work/safe/VibeTV Control Center.app/Contents"
  printf '<plist version="1.0"><dict/></plist>\n' > "$work/safe/VibeTV Control Center.app/Contents/Info.plist"
  COPYFILE_DISABLE=1 tar -czf "$work/safe.tar.gz" -C "$work/safe" "VibeTV Control Center.app"
  "$EXTRACTOR" --archive "$work/safe.tar.gz" --output "$work/extracted" >/dev/null
  [[ -f "$work/extracted/VibeTV Control Center.app/Contents/Info.plist" ]] \
    || die "safe candidate archive was not extracted"

  python3 - "$work/unsafe.tar.gz" <<'PY'
import io
import sys
import tarfile

with tarfile.open(sys.argv[1], "w:gz") as archive:
    member = tarfile.TarInfo("../../escape")
    payload = b"unsafe"
    member.size = len(payload)
    archive.addfile(member, io.BytesIO(payload))
PY
  if "$EXTRACTOR" --archive "$work/unsafe.tar.gz" --output "$work/unsafe" >/dev/null 2>&1; then
    die "unsafe candidate archive path was accepted"
  fi
}

assert_gate_repair_scope() {
  local work base_sha allowed_sha blocked_sha scope_error
  work="$(mktemp -d "${TMPDIR:-/tmp}/vibetv-gate-repair-scope.XXXXXX")"
  trap 'rm -rf "${work:-}"' RETURN

  git -C "$work" init -q
  git -C "$work" config user.name "CODEX Gate Test"
  git -C "$work" config user.email "gate-test@vibetv.invalid"
  printf 'baseline\n' > "$work/README.md"
  git -C "$work" add README.md
  git -C "$work" commit -qm baseline
  base_sha="$(git -C "$work" rev-parse HEAD)"

  mkdir -p "$work/scripts"
  printf '# allowed gate test\n' > "$work/scripts/test-vibetv-hosted-gates.sh"
  git -C "$work" add scripts/test-vibetv-hosted-gates.sh
  git -C "$work" commit -qm allowed
  allowed_sha="$(git -C "$work" rev-parse HEAD)"
  (cd "$work" && "$GATE_REPAIR_SCOPE" "$base_sha" "$allowed_sha" >/dev/null) \
    || die "safe gate repair scope was rejected"

  mkdir -p "$work/firmware_esp8266/src"
  printf '// blocked product change\n' > "$work/firmware_esp8266/src/main.cpp"
  git -C "$work" add firmware_esp8266/src/main.cpp
  git -C "$work" commit -qm blocked
  blocked_sha="$(git -C "$work" rev-parse HEAD)"
  if scope_error="$(cd "$work" && "$GATE_REPAIR_SCOPE" "$base_sha" "$blocked_sha" 2>&1)"; then
    die "product code was accepted as a gate-only repair"
  fi
  [[ "$scope_error" == *"outside the safe scope"* ]] \
    || die "unsafe gate repair scope failed for the wrong reason: $scope_error"
}

main() {
  assert_file "$CI_WORKFLOW"
  assert_file "$MERGE_WORKFLOW"
  assert_file "$RC_WORKFLOW"
  assert_file "$GATE_REPAIR_WORKFLOW"
  assert_file "$GATE_REPAIR_SCOPE"
  assert_file "$EXTRACTOR"
  assert_file "$GUEST_TEST"
  assert_file "$SPARKLE_BUILDER"

  assert_contains "$CI_WORKFLOW" 'codex-ci:' \
    'CI needs one stable CODEX CI aggregation job'
  assert_contains "$CI_WORKFLOW" 'name: CODEX CI' \
    'stable aggregation status must be named CODEX CI'
  assert_contains "$CI_WORKFLOW" 'if: always()' \
    'CODEX CI must report failure even when an upstream job fails'

  assert_contains "$MERGE_WORKFLOW" 'name: CODEX Test VibeTV Merge' \
    'merge gate workflow needs the stable CODEX name'
  assert_contains "$MERGE_WORKFLOW" 'pr_number:' \
    'merge gate must accept an explicit pull request number'
  assert_contains "$MERGE_WORKFLOW" 'pulls/${pr_number}' \
    'merge gate must resolve the pull request through GitHub before building'
  assert_contains "$MERGE_WORKFLOW" 'get("head", {}).get("sha"' \
    'merge gate must use the exact pull request head SHA'
  assert_contains "$MERGE_WORKFLOW" 'persist-credentials: false' \
    'untrusted source checkouts must not persist GitHub credentials'
  assert_contains "$MERGE_WORKFLOW" 'ref: ${{ github.workflow_sha }}' \
    'secret-bearing merge jobs must run trusted main workflow code'
  assert_contains "$MERGE_WORKFLOW" 'CODEX VibeTV Merge Gate' \
    'merge gate must publish its stable commit status context'
  assert_contains "$MERGE_WORKFLOW" 'statuses: write' \
    'only the trusted status job may write the merge-gate commit status'
  assert_contains "$MERGE_WORKFLOW" 'runs-on: macos-15' \
    'merge gate must run its direct macOS checks on GitHub-hosted macOS 15'
  assert_contains "$MERGE_WORKFLOW" '9999.0.${GITHUB_RUN_NUMBER}' \
    'merge candidate must always sort above public releases for Sparkle'
  assert_contains "$MERGE_WORKFLOW" 'clean_os' \
    'merge gate must cover a clean macOS customer state'
  assert_contains "$MERGE_WORKFLOW" 'current_public' \
    'merge gate must cover the current public customer state'
  assert_contains "$MERGE_WORKFLOW" 'previous_public' \
    'merge gate must cover the previous public customer state'
  assert_not_contains "$MERGE_WORKFLOW" 'self-hosted' \
    'merge gate must not depend on a self-hosted runner'
  assert_not_contains "$MERGE_WORKFLOW" 'tart' \
    'merge gate must not use Tart'

  assert_contains "$CI_WORKFLOW" './scripts/test-vibetv-hosted-gates.sh' \
    'normal PR CI must test changes to the hosted VibeTV gate itself'

  assert_contains "$GATE_REPAIR_WORKFLOW" 'name: CODEX Test VibeTV Gate Repair' \
    'gate repair workflow needs the stable CODEX name'
  assert_contains "$GATE_REPAIR_WORKFLOW" 'ref: ${{ github.workflow_sha }}' \
    'gate repair scope validation must use trusted main code'
  assert_contains "$GATE_REPAIR_WORKFLOW" 'persist-credentials: false' \
    'untrusted gate repair checkouts must not persist GitHub credentials'
  assert_contains "$GATE_REPAIR_WORKFLOW" 'CODEX VibeTV Gate Repair' \
    'gate repair workflow must publish its stable commit status context'
  assert_not_contains "$GATE_REPAIR_WORKFLOW" 'secrets.' \
    'gate repair workflow must remain completely secrets-free'

  local untrusted_build
  untrusted_build="$(job_block "$MERGE_WORKFLOW" 'build-untrusted')"
  [[ -n "$untrusted_build" ]] || die 'merge workflow needs a build-untrusted job'
  [[ "$untrusted_build" != *'secrets.'* ]] || die 'untrusted PR build must not receive signing secrets'
  [[ "$untrusted_build" != *'SPARKLE_ED25519_PRIVATE_KEY'* ]] \
    || die 'untrusted PR build must not receive the Sparkle signing key'

  assert_contains "$RC_WORKFLOW" 'name: CODEX Test VibeTV Release Candidate' \
    'release-candidate workflow needs the stable CODEX name'
  assert_contains "$RC_WORKFLOW" 'version:' \
    'release-candidate workflow must require a candidate version'
  assert_contains "$RC_WORKFLOW" 'ref: ${{ github.sha }}' \
    'release candidate must build the exact main SHA that dispatched it'
  assert_contains "$RC_WORKFLOW" 'candidate-manifest.json' \
    'release candidate must emit an immutable candidate manifest'
  assert_contains "$RC_WORKFLOW" 'name: vibetv-release-candidate' \
    'release candidate artifact name must remain stable for downstream gates'
  for required in publish/ test/ install.sh install-control-center-companion.sh checksums-v firmware-versions.json 'download/v${version}' '"publish"'; do
    assert_contains "$RC_WORKFLOW" "$required" \
      "release candidate must build the full publish asset set including ${required}"
  done
  for field in repository sourceSha version candidateRunId createdAt virtualGate; do
    assert_contains "$RC_WORKFLOW" "\"${field}\"" \
      "candidate manifest must include ${field}"
  done
  assert_contains "$RC_WORKFLOW" 'retention-days: 7' \
    'release candidate artifacts and reports must remain available for seven days'
  assert_contains "$RC_WORKFLOW" 'name: vibetv-release-candidate-result' \
    'release candidate result artifact name must remain stable for publish gates'
  for field in artifactHashes candidate-result.json 'result = "success"'; do
    assert_contains "$RC_WORKFLOW" "$field" \
      "candidate result must include ${field}"
  done
  assert_not_contains "$RC_WORKFLOW" 'self-hosted' \
    'release candidate must not depend on a self-hosted runner'
  assert_not_contains "$RC_WORKFLOW" 'Tart' \
    'release candidate must not use Tart'

  assert_contains "$GUEST_TEST" 'verify-macos-control-center-dmg.sh' \
    'direct guest test must verify the signed and notarized DMG'
  assert_contains "$GUEST_TEST" '47832' \
    'direct guest test must check the Companion port'
  assert_contains "$GUEST_TEST" 'virtual-vibetv' \
    'direct guest test must exercise the Virtual VibeTV interface'
  assert_contains "$GUEST_TEST" 'no-op' \
    'direct guest test must prove no-op firmware behavior'
  assert_contains "$GUEST_TEST" 'screencapture' \
    'direct guest test must preserve a macOS screenshot artifact'
  assert_contains "$GUEST_TEST" '/Applications/VibeTV Control Center.app' \
    'guest test must install the baseline or candidate app in Applications'
  assert_contains "$GUEST_TEST" '--user-agent-name' \
    'guest test must run the official Sparkle CLI instead of parsing XML'
  assert_contains "$GUEST_TEST" '--check-immediately' \
    'guest test must force a live Sparkle update check'
  assert_contains "$GUEST_TEST" 'baseline app did not start' \
    'guest test must start the public baseline before Sparkle'
  assert_contains "$GUEST_TEST" 'replace and relaunch' \
    'guest test must require a replacement Candidate process after Sparkle'
  assert_contains "$GUEST_TEST" 'gzip -cd' \
    'guest test must hash the raw firmware bytes sent through OTA'
  assert_contains "$RC_WORKFLOW" 'artifactHashes": {item["path"]' \
    'candidate result must expose publish validators a path-to-hash map'
  assert_contains "$RC_WORKFLOW" 'check-firmware-size-budget.sh' \
    'release candidate must enforce the release firmware size budgets'
  assert_contains "$RC_WORKFLOW" 'shasum -a 256 -c "checksums-v${version}.txt"' \
    'release candidate must verify its publish checksum asset before upload'
  assert_contains "$RC_WORKFLOW" "kind + 'Sha256'" \
    'release candidate must freeze public baseline DMG hashes'
  assert_contains "$RC_WORKFLOW" 'baselines/${{ matrix.state }}.dmg' \
    'guest matrix must consume the frozen baseline bytes'
  assert_contains "$RC_WORKFLOW" '"protocolVersion":config.get' \
    'release candidate must preserve release firmware protocol metadata'
  assert_contains "$SPARKLE_BUILDER" '6276ba2b404829d139c45ff98427cf90e2efc59b' \
    'Sparkle CLI source must be pinned to the reviewed upstream commit'
  assert_contains "$GUEST_TEST" 'CANDIDATE_COMPANION' \
    'guest test must select the installed candidate companion for OTA'
  assert_contains "$GUEST_TEST" 'install-update --target' \
    'guest test must use the bundled candidate companion for OTA'
  assert_contains "$GUEST_TEST" 'daemon --transport wifi' \
    'guest test must exercise the bundled candidate companion render path'

  assert_gate_repair_scope
  assert_safe_app_extractor
  printf 'PASS: hosted VibeTV merge and release-candidate gate contracts\n'
}

main "$@"
