#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CI_WORKFLOW="${ROOT}/.github/workflows/ci.yml"
MERGE_WORKFLOW="${ROOT}/.github/workflows/vibetv-merge-gate.yml"
RC_WORKFLOW="${ROOT}/.github/workflows/vibetv-release-candidate.yml"
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

assert_before() {
  local file="$1"
  local first="$2"
  local second="$3"
  local message="$4"
  local first_line second_line
  first_line="$(grep -nF -- "$first" "$file" | head -n 1 | cut -d: -f1 || true)"
  second_line="$(grep -nF -- "$second" "$file" | head -n 1 | cut -d: -f1 || true)"
  [[ -n "$first_line" && -n "$second_line" && "$first_line" -lt "$second_line" ]] || die "$message"
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

  mkdir -p "$work/safe/VibeTV Control Center.app/Contents/Frameworks/Test.framework/Versions/B/Resources"
  printf '<plist version="1.0"><dict/></plist>\n' > "$work/safe/VibeTV Control Center.app/Contents/Info.plist"
  ln -s B "$work/safe/VibeTV Control Center.app/Contents/Frameworks/Test.framework/Versions/Current"
  ln -s Versions/Current/Resources "$work/safe/VibeTV Control Center.app/Contents/Frameworks/Test.framework/Resources"
  COPYFILE_DISABLE=1 tar -czf "$work/safe.tar.gz" -C "$work/safe" "VibeTV Control Center.app"
  "$EXTRACTOR" --archive "$work/safe.tar.gz" --output "$work/extracted" >/dev/null
  [[ -f "$work/extracted/VibeTV Control Center.app/Contents/Info.plist" ]] \
    || die "safe candidate archive was not extracted"
  [[ -d "$work/extracted/VibeTV Control Center.app/Contents/Frameworks/Test.framework/Resources" ]] \
    || die "safe framework symlinks were not preserved"

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

  python3 - "$work/unsafe-link.tar.gz" <<'PY'
import sys
import tarfile

with tarfile.open(sys.argv[1], "w:gz") as archive:
    member = tarfile.TarInfo("VibeTV Control Center.app/Contents/Frameworks/escape")
    member.type = tarfile.SYMTYPE
    member.linkname = "../../../../escape"
    archive.addfile(member)
PY
  local unsafe_link_error
  if unsafe_link_error="$("$EXTRACTOR" --archive "$work/unsafe-link.tar.gz" --output "$work/unsafe-link" 2>&1)"; then
    die "escaping candidate archive symlink was accepted"
  fi
  [[ "$unsafe_link_error" == *"unsafe candidate archive symlink"* ]] \
    || die "escaping symlink test failed for the wrong reason: $unsafe_link_error"

  python3 - "$work/chained-link.tar.gz" <<'PY'
import io
import sys
import tarfile

root = "VibeTV Control Center.app"
with tarfile.open(sys.argv[1], "w:gz") as archive:
    plist = tarfile.TarInfo(f"{root}/Contents/Info.plist")
    plist_payload = b'<plist version="1.0"><dict/></plist>\n'
    plist.size = len(plist_payload)
    archive.addfile(plist, io.BytesIO(plist_payload))
    for name, target in [
        (f"{root}/a", "."),
        (f"{root}/a/b", ".."),
        (f"{root}/a/b/c", ".."),
    ]:
        link = tarfile.TarInfo(name)
        link.type = tarfile.SYMTYPE
        link.linkname = target
        archive.addfile(link)
    escaped = tarfile.TarInfo(f"{root}/a/b/c/escaped")
    payload = b"outside output"
    escaped.size = len(payload)
    archive.addfile(escaped, io.BytesIO(payload))
PY
  local chained_link_error
  if chained_link_error="$("$EXTRACTOR" --archive "$work/chained-link.tar.gz" --output "$work/chained-output" 2>&1)"; then
    die "archive with a symlinked parent was accepted"
  fi
  [[ "$chained_link_error" == *"candidate archive member descends through symlink"* ]] \
    || die "symlink ancestor test failed for the wrong reason: $chained_link_error"
  [[ ! -e "$work/escaped" ]] \
    || die "archive symlink chain wrote outside the output directory"

  python3 - "$work/duplicate-path.tar.gz" <<'PY'
import io
import sys
import tarfile

root = "VibeTV Control Center.app"
with tarfile.open(sys.argv[1], "w:gz") as archive:
    plist = tarfile.TarInfo(f"{root}/Contents/Info.plist")
    plist_payload = b'<plist version="1.0"><dict/></plist>\n'
    plist.size = len(plist_payload)
    archive.addfile(plist, io.BytesIO(plist_payload))
    link = tarfile.TarInfo(f"{root}/duplicate")
    link.type = tarfile.SYMTYPE
    link.linkname = "Contents/Info.plist"
    archive.addfile(link)
    duplicate = tarfile.TarInfo(f"{root}/duplicate")
    payload = b"duplicate path"
    duplicate.size = len(payload)
    archive.addfile(duplicate, io.BytesIO(payload))
PY
  local duplicate_path_error
  if duplicate_path_error="$("$EXTRACTOR" --archive "$work/duplicate-path.tar.gz" --output "$work/duplicate-output" 2>&1)"; then
    die "archive with a duplicate symlink path was accepted"
  fi
  [[ "$duplicate_path_error" == *"duplicate candidate archive path"* ]] \
    || die "duplicate path test failed for the wrong reason: $duplicate_path_error"

  python3 - "$work/casefold-parent.tar.gz" <<'PY'
import io
import sys
import tarfile

root = "VibeTV Control Center.app"
with tarfile.open(sys.argv[1], "w:gz") as archive:
    plist = tarfile.TarInfo(f"{root}/Contents/Info.plist")
    plist_payload = b'<plist version="1.0"><dict/></plist>\n'
    plist.size = len(plist_payload)
    archive.addfile(plist, io.BytesIO(plist_payload))
    link = tarfile.TarInfo(f"{root}/A")
    link.type = tarfile.SYMTYPE
    link.linkname = "."
    archive.addfile(link)
    nested = tarfile.TarInfo(f"{root}/a/payload")
    payload = b"case-insensitive parent"
    nested.size = len(payload)
    archive.addfile(nested, io.BytesIO(payload))
PY
  local casefold_parent_error
  if casefold_parent_error="$("$EXTRACTOR" --archive "$work/casefold-parent.tar.gz" --output "$work/casefold-output" 2>&1)"; then
    die "archive with a case-variant symlink parent was accepted"
  fi
  [[ "$casefold_parent_error" == *"candidate archive member descends through symlink"* ]] \
    || die "casefold symlink ancestor test failed for the wrong reason: $casefold_parent_error"

  python3 - "$work/symlink-cycle.tar.gz" <<'PY'
import io
import sys
import tarfile

root = "VibeTV Control Center.app"
with tarfile.open(sys.argv[1], "w:gz") as archive:
    plist = tarfile.TarInfo(f"{root}/Contents/Info.plist")
    plist_payload = b'<plist version="1.0"><dict/></plist>\n'
    plist.size = len(plist_payload)
    archive.addfile(plist, io.BytesIO(plist_payload))
    for name, target in [(f"{root}/a", "b"), (f"{root}/b", "a")]:
        link = tarfile.TarInfo(name)
        link.type = tarfile.SYMTYPE
        link.linkname = target
        archive.addfile(link)
PY
  local symlink_cycle_error
  if symlink_cycle_error="$("$EXTRACTOR" --archive "$work/symlink-cycle.tar.gz" --output "$work/symlink-cycle-output" 2>&1)"; then
    die "archive with a symlink cycle was accepted"
  fi
  [[ "$symlink_cycle_error" == *"unsafe candidate archive symlink cannot resolve"* ]] \
    || die "symlink cycle test failed for the wrong reason: $symlink_cycle_error"
  [[ ! -e "$work/symlink-cycle-output" ]] \
    || die "symlink cycle left a partially extracted candidate app behind"
}

main() {
  assert_file "$CI_WORKFLOW"
  assert_file "$MERGE_WORKFLOW"
  assert_file "$RC_WORKFLOW"
  assert_file "$EXTRACTOR"
  assert_file "$GUEST_TEST"
  assert_file "$SPARKLE_BUILDER"

  assert_contains "$CI_WORKFLOW" 'codex-ci:' \
    'CI needs one stable CODEX CI aggregation job'
  assert_contains "$CI_WORKFLOW" 'name: CODEX CI' \
    'stable aggregation status must be named CODEX CI'
  assert_contains "$CI_WORKFLOW" 'if: always()' \
    'CODEX CI must report failure even when an upstream job fails'
  assert_contains "$CI_WORKFLOW" './scripts/test-vibetv-hosted-gates.sh' \
    'normal PR CI must run the hosted VibeTV gate contracts'

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
  assert_contains "$MERGE_WORKFLOW" 'build="${GITHUB_RUN_ID}"' \
    'merge candidate build must sort above public release build numbers for Sparkle'
  assert_contains "$MERGE_WORKFLOW" '--build "$build"' \
    'merge candidate app must use the unique high Sparkle build number'
  assert_contains "$MERGE_WORKFLOW" 'clean_os' \
    'merge gate must cover a clean macOS customer state'
  assert_contains "$MERGE_WORKFLOW" 'current_public' \
    'merge gate must cover the current public customer state'
  assert_contains "$MERGE_WORKFLOW" 'previous_public' \
    'merge gate must cover the previous public customer state'
  for merge_candidate_path in \
    dist/macos/candidate-manifest.json \
    dist/macos/VibeTV-Control-Center.dmg \
    dist/macos/appcast.xml \
    tmp/vibetv-merge/virtual-vibetv \
    tmp/vibetv-merge/codexbar-display \
    tmp/vibetv-merge/firmware.bin \
    tmp/vibetv-merge/firmware-manifest.json; do
    assert_contains "$MERGE_WORKFLOW" "candidate/${merge_candidate_path}" \
      "merge guest matrix must consume the uploaded ${merge_candidate_path} path"
  done
  assert_contains "$MERGE_WORKFLOW" '"${baseline_args[@]+"${baseline_args[@]}"}"' \
    'clean OS merge guest test must expand optional baseline arguments safely under set -u'
  assert_contains "$MERGE_WORKFLOW" 'chmod +x candidate/tmp/vibetv-merge/virtual-vibetv candidate/tmp/vibetv-merge/codexbar-display' \
    'merge guest matrix must restore executable bits lost during artifact transfer'
  assert_contains "$MERGE_WORKFLOW" "cp 'dist/macos/VibeTV Control Center.app/Contents/Helpers/codexbar-display' tmp/vibetv-merge/codexbar-display" \
    'merge candidate must compare the installed helper with the same signed companion artifact'
  assert_not_contains "$MERGE_WORKFLOW" 'self-hosted' \
    'merge gate must not depend on a self-hosted runner'
  assert_not_contains "$MERGE_WORKFLOW" 'tart' \
    'merge gate must not use Tart'

  local untrusted_build
  untrusted_build="$(job_block "$MERGE_WORKFLOW" 'build-untrusted')"
  [[ -n "$untrusted_build" ]] || die 'merge workflow needs a build-untrusted job'
  [[ "$untrusted_build" != *'secrets.'* ]] || die 'untrusted PR build must not receive signing secrets'
  [[ "$untrusted_build" != *'SPARKLE_ED25519_PRIVATE_KEY'* ]] \
    || die 'untrusted PR build must not receive the Sparkle signing key'

  assert_contains "$RC_WORKFLOW" 'name: CODEX Prepare and Release VibeTV' \
    'release workflow needs the stable CODEX name'
  assert_contains "$RC_WORKFLOW" 'version:' \
    'release-candidate workflow must require a candidate version'
  assert_contains "$RC_WORKFLOW" 'firmware:' \
    'release-candidate workflow must choose final firmware versions before build'
  assert_contains "$RC_WORKFLOW" 'effective-firmware-versions.json' \
    'release candidate must freeze its final firmware versions'
  assert_contains "$RC_WORKFLOW" 'uses: ./.github/workflows/release.yml' \
    'successful candidate tests must continue to the Production approval'
  assert_contains "$ROOT/scripts/lib/vibetv-rehearsal.sh" \
    'vibetv-release-candidate-result' \
    'manual rehearsal must require the successful result of a waiting candidate'
  assert_not_contains "$ROOT/scripts/lib/vibetv-rehearsal.sh" \
    '--workflow vibetv-release-candidate.yml --status success' \
    'manual rehearsal must discover candidates waiting for Production approval'
  assert_contains "$RC_WORKFLOW" 'ref: ${{ github.sha }}' \
    'release candidate must build the exact main SHA that dispatched it'
  assert_contains "$RC_WORKFLOW" 'pip install platformio intelhex' \
    'release candidate must install the ESP32 bootloader dependency on macOS'
  assert_contains "$RC_WORKFLOW" 'candidate-manifest.json' \
    'release candidate must emit an immutable candidate manifest'
  assert_contains "$RC_WORKFLOW" 'name: vibetv-release-candidate' \
    'release candidate artifact name must remain stable for downstream gates'
  for required in publish/ test/ install.sh install-control-center-companion.sh checksums-v firmware-versions.json 'download/v${version}' '"publish"'; do
    assert_contains "$RC_WORKFLOW" "$required" \
      "release candidate must build the full publish asset set including ${required}"
  done
  assert_contains "$RC_WORKFLOW" '--notary-log tmp/vibetv-rc/test/notarization-log.json' \
    'release candidate must retain structured Apple notarization evidence'
  assert_contains "$RC_WORKFLOW" 'notarization-evidence' \
    'candidate manifest must classify notarization evidence as test-only'
  for field in repository sourceSha version candidateRunId createdAt virtualGate; do
    assert_contains "$RC_WORKFLOW" "\"${field}\"" \
      "candidate manifest must include ${field}"
  done
  assert_contains "$RC_WORKFLOW" 'retention-days: 30' \
    'release candidate artifacts and reports must remain available for thirty days'
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
  assert_contains "$GUEST_TEST" 'gzip -t "$FIRMWARE"' \
    'guest test must distinguish compressed release firmware from raw merge firmware'
  assert_contains "$GUEST_TEST" 'gzip -cd "$FIRMWARE"' \
    'guest test must derive raw OTA bytes from compressed release firmware'
  assert_contains "$GUEST_TEST" 'cp "$FIRMWARE" "$RAW_FIRMWARE"' \
    'guest test must preserve already raw merge firmware bytes'
  assert_contains "$GUEST_TEST" 'shasum -a 256 "$RAW_FIRMWARE"' \
    'guest test must hash the raw firmware bytes sent through OTA'
  assert_contains "$RC_WORKFLOW" 'artifactHashes": {item["path"]' \
    'candidate result must expose publish validators a path-to-hash map'
  assert_contains "$RC_WORKFLOW" 'check-firmware-size-budget.sh' \
    'release candidate must enforce the release firmware size budgets'
  assert_contains "$RC_WORKFLOW" 'shasum -a 256 -c "checksums-v${version}.txt"' \
    'release candidate must verify its publish checksum asset before upload'
  assert_contains "$RC_WORKFLOW" 'find . -type f ! -name "checksums-*"' \
    'release candidate must exclude its checksum asset from its own checksum list'
  assert_contains "$RC_WORKFLOW" "kind + 'Sha256'" \
    'release candidate must freeze public baseline DMG hashes'
  local frozen_baseline
  for frozen_baseline in dmg appcast.xml firmware-manifest.json; do
    assert_contains "$RC_WORKFLOW" 'baselines/baselines/${{ matrix.state }}.'"${frozen_baseline}" \
      "guest matrix must consume the downloaded frozen ${frozen_baseline} bytes"
  done
  assert_contains "$RC_WORKFLOW" 'firmware_asset="$(python3' \
    'release candidate must resolve the tested firmware from its own manifest'
  assert_contains "$RC_WORKFLOW" '"${baseline_args[@]+"${baseline_args[@]}"}"' \
    'clean OS guest test must expand optional baseline arguments safely under set -u'
  assert_contains "$RC_WORKFLOW" '"protocolVersion":config.get' \
    'release candidate must preserve release firmware protocol metadata'
  assert_contains "$SPARKLE_BUILDER" '6276ba2b404829d139c45ff98427cf90e2efc59b' \
    'Sparkle CLI source must be pinned to the reviewed upstream commit'
  assert_contains "$SPARKLE_BUILDER" 'git -C "$work/source" checkout -q --detach FETCH_HEAD' \
    'Sparkle CLI build must check out the fetched pinned source commit'
  assert_contains "$GUEST_TEST" 'CANDIDATE_COMPANION' \
    'guest test must select the installed candidate companion for OTA'
  assert_contains "$GUEST_TEST" 'install-update --target' \
    'guest test must use the bundled candidate companion for OTA'
  assert_contains "$GUEST_TEST" 'daemon --transport wifi' \
    'guest test must exercise the bundled candidate companion render path'
  assert_contains "$GUEST_TEST" 'if [[ "$STATE" == clean_os ]]; then' \
    'guest test must run a standalone candidate daemon only on a clean OS'
  assert_contains "$GUEST_TEST" 'if ! "$CANDIDATE_COMPANION" daemon' \
    'clean OS guest test must inspect an expected no-provider daemon exit'
  assert_contains "$GUEST_TEST" 'error code=runtime/no-providers' \
    'clean OS guest test must only tolerate the known no-provider result'
  assert_contains "$GUEST_TEST" '/v1/device/repair' \
    'public guest states must ask the installed runtime to render to the virtual VibeTV'
  assert_before "$GUEST_TEST" 'validate_installed_runtime "$OUTPUT/candidate-runtime-status.json"' '/v1/device/repair' \
    'public guest states must verify the installed candidate runtime before requesting a render'
  assert_contains "$GUEST_TEST" 'http://127.0.0.1:47832/v1/updates/install' \
    'public guest states must drive the firmware update through the installed runtime API, not a direct CLI flash'
  assert_contains "$GUEST_TEST" '/v1/updates/install/status?jobId=' \
    'guest test must wait for the runtime firmware update job to finish'
  assert_before "$GUEST_TEST" '/v1/device/repair' 'api_firmware_update "$OUTPUT/candidate-install-update.json"' \
    'the runtime must own the paired device before the API firmware update starts'
  assert_contains "$GUEST_TEST" 'api_firmware_update "$OUTPUT/candidate-already-current.json" already_current' \
    'public guest states must prove already_current through the runtime API as well'
  assert_contains "$GUEST_TEST" 'if expected_uploads and not any(event.get("path") == "/update/firmware.raw"' \
    'the Raw OTA assertion must be conditional: a candidate whose firmware matches the baseline uploads nothing, and demanding a Raw OTA regardless fails every release that ships no new firmware'
  assert_contains "$GUEST_TEST" 'expected_uploads = int(sys.argv[2])' \
    'guest test must read the expected upload count once and reuse it for both state assertions'
  assert_contains "$GUEST_TEST" 'listenerOwner' \
    'guest test must bind the live Companion port to the installed runtime service'
  assert_contains "$GUEST_TEST" 'installationMode' \
    'guest test must verify the running candidate reports DMG installation mode'
  assert_contains "$GUEST_TEST" '--max-time 3 http://127.0.0.1:47832/v1/status' \
    'guest test must bound each installed-runtime status request'
  assert_contains "$GUEST_TEST" 'if runtime_pid="$(python3 - "$status_output"' \
    'guest test must keep polling until the candidate runtime status itself validates'
  assert_contains "$GUEST_TEST" 'shop.vibetv.control-center.runtime.registered-bundle-version' \
    'guest test must wait for native app preparation to finish before driving the runtime update API'
  assert_contains "$GUEST_TEST" 'deadline=$((SECONDS + 120))' \
    'guest test must preserve the full native preparation and recovery timeout'
  assert_not_contains "$GUEST_TEST" 'validate-macos-control-center-runtime.sh' \
    'stateful guest checks must not invoke the clean-host runtime validator'
  assert_not_contains "$GUEST_TEST" '--once --api-addr' \
    'one-shot candidate daemon must not keep a companion API server alive'

  assert_safe_app_extractor
  printf 'PASS: hosted VibeTV merge and release-candidate gate contracts\n'
}

main "$@"
