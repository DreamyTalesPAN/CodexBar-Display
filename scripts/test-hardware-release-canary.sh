#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CANARY="${ROOT}/scripts/test-physical-release-canary.sh"
VALIDATOR="${ROOT}/scripts/validate-hardware-canary.py"
WORKFLOW="${ROOT}/.github/workflows/record-hardware-canary.yml"
TMP="$(mktemp -d)"
trap 'rm -rf "${TMP}"' EXIT

die() {
  printf 'error: %s\n' "$*" >&2
  exit 1
}

sha256() {
  shasum -a 256 "$1" | awk '{print $1}'
}

make_candidate() {
  local dir="$1"
  mkdir -p "${dir}/companion" "${dir}/firmware" "${dir}/macos" "${dir}/virtual"
  printf '#!/usr/bin/env bash\nexit 0\n' >"${dir}/companion/codexbar-display"
  chmod +x "${dir}/companion/codexbar-display"
  printf 'virtual firmware\n' >"${dir}/firmware/firmware.bin"
  printf 'signed DMG fixture\n' >"${dir}/macos/VibeTV-Control-Center.dmg"
  printf '<appcast/>\n' >"${dir}/macos/appcast.xml"
  printf 'virtual VibeTV fixture\n' >"${dir}/virtual/virtual-vibetv"
  cat >"${dir}/firmware/firmware-manifest.json" <<'JSON'
{"schemaVersion":1,"artifacts":[{"board":"esp8266-smalltv-st7789","firmwareVersion":"1.0.1","asset":"firmware/firmware.bin","firmwareUrl":"https://example.invalid/firmware.bin","sha256":"placeholder"}]}
JSON
  local firmware_hash manifest_hash companion_hash
  firmware_hash="$(sha256 "${dir}/firmware/firmware.bin")"
  python3 - "${dir}/firmware/firmware-manifest.json" "${firmware_hash}" <<'PY'
import json, sys
path, digest = sys.argv[1:]
with open(path, encoding="utf-8") as f:
    body = json.load(f)
body["artifacts"][0]["sha256"] = digest
with open(path, "w", encoding="utf-8") as f:
    json.dump(body, f, separators=(",", ":"))
PY
  manifest_hash="$(sha256 "${dir}/firmware/firmware-manifest.json")"
  companion_hash="$(sha256 "${dir}/companion/codexbar-display")"
  cat >"${dir}/candidate-manifest.json" <<JSON
{"schemaVersion":1,"repository":"DreamyTalesPAN/CodexBar-Display","sourceSha":"0123456789abcdef0123456789abcdef01234567","version":"1.0.1","candidateRunId":"123","createdAt":"2026-07-28T00:00:00Z","artifacts":[{"name":"signed-dmg","path":"macos/VibeTV-Control-Center.dmg","sha256":"$(sha256 "${dir}/macos/VibeTV-Control-Center.dmg")","role":"signed-dmg","publish":true},{"name":"sparkle-appcast","path":"macos/appcast.xml","sha256":"$(sha256 "${dir}/macos/appcast.xml")","role":"sparkle-appcast","publish":true},{"name":"candidate-companion","path":"companion/codexbar-display","sha256":"${companion_hash}","role":"companion","publish":true},{"name":"virtual-vibetv","path":"virtual/virtual-vibetv","sha256":"$(sha256 "${dir}/virtual/virtual-vibetv")","role":"virtual-vibetv","publish":false},{"name":"firmware-manifest","path":"firmware/firmware-manifest.json","sha256":"${manifest_hash}","role":"firmware-manifest","publish":true},{"name":"firmware-image","path":"firmware/firmware.bin","sha256":"${firmware_hash}","role":"firmware","publish":true}],"virtualGate":{"result":"pending","runId":"123"}}
JSON
}

make_evidence() {
  local candidate="$1"
  local evidence="$2"
  python3 - "${candidate}" "${evidence}" <<'PY'
import hashlib, json, pathlib, sys
root, output = map(pathlib.Path, sys.argv[1:]); manifest = json.loads((root / 'candidate-manifest.json').read_text())
hashes = {item['path']: hashlib.sha256((root / item['path']).read_bytes()).hexdigest() for item in manifest['artifacts']}
json.dump({'schemaVersion':1,'repository':manifest['repository'],'sourceSha':manifest['sourceSha'],'version':manifest['version'],'candidateRunId':manifest['candidateRunId'],'candidateManifestSha256':hashlib.sha256((root/'candidate-manifest.json').read_bytes()).hexdigest(),'artifactHashes':hashes,'device':{'deviceId':'vibetv-test-1','board':'esp8266-smalltv-st7789','firmwareBefore':'1.0.0','firmwareAfter':'1.0.1'},'checks':{'candidateVerified':True,'hello':True,'health':True,'daemonRender':True},'timestamps':{'startedAt':'2026-07-28T00:00:00Z','finishedAt':'2026-07-28T00:01:00Z'},'actor':'test','result':'success'}, output.open('w'), separators=(',',':'))
PY
}

make_candidate_result() {
  local candidate="$1"
  local result_dir="$2"
  mkdir -p "${result_dir}"
  python3 - "${candidate}" "${result_dir}/candidate-result.json" <<'PY'
import hashlib, json, pathlib, sys
root, output = map(pathlib.Path, sys.argv[1:])
manifest = json.loads((root / "candidate-manifest.json").read_text())
hashes = {item["path"]: hashlib.sha256((root / item["path"]).read_bytes()).hexdigest() for item in manifest["artifacts"]}
json.dump({"schemaVersion": 1, "repository": manifest["repository"], "sourceSha": manifest["sourceSha"], "version": manifest["version"], "candidateRunId": manifest["candidateRunId"], "result": "success", "artifactHashes": hashes}, output.open("w"), separators=(",", ":"))
PY
}

main() {
  [[ -x "${CANARY}" ]] || die "physical canary script is missing or not executable"
  [[ -x "${VALIDATOR}" ]] || die "hardware canary validator is missing or not executable"
  [[ -f "${WORKFLOW}" ]] || die "hardware canary workflow is missing"

  local candidate="${TMP}/candidate"
  make_candidate "${candidate}"
  local plan
  plan="$("${CANARY}" --candidate-dir "${candidate}" --target "http://127.0.0.1:9" --expected-device-id "vibetv-test-1" --output-dir "${TMP}/output" --dry-run)"
  [[ "${plan}" == *"DRY RUN: no network, launchctl, or hardware command will run"* ]] || die "dry run did not state its no-side-effect contract"
  [[ "${plan}" == *"candidate verified"* ]] || die "dry run did not verify the candidate fixture"
  [[ ! -e "${TMP}/output/hardware-canary.json" ]] || die "dry run must not write evidence"

  "${VALIDATOR}" candidate --candidate-dir "${candidate}" >/dev/null
  local evidence="${TMP}/hardware-canary.json"
  make_evidence "${candidate}" "${evidence}"
  local candidate_result="${TMP}/candidate-result"
  make_candidate_result "${candidate}" "${candidate_result}"
  "${VALIDATOR}" candidate-result --candidate-dir "${candidate}" --result "${candidate_result}/candidate-result.json" >/dev/null
  "${VALIDATOR}" evidence --candidate-dir "${candidate}" --evidence "${evidence}" >/dev/null
  python3 - "${evidence}" <<'PY'
import json, sys
path = sys.argv[1]
with open(path, encoding="utf-8") as f:
    body = json.load(f)
body["artifactHashes"]["firmware/firmware.bin"] = "0" * 64
with open(path, "w", encoding="utf-8") as f:
    json.dump(body, f)
PY
  if "${VALIDATOR}" evidence --candidate-dir "${candidate}" --evidence "${evidence}" >/dev/null 2>&1; then
    die "validator accepted evidence with a mismatched artifact hash"
  fi

  grep -F 'name: CODEX Record VibeTV Hardware Canary' "${WORKFLOW}" >/dev/null || die "workflow name is missing"
  grep -F 'evidence_base64' "${WORKFLOW}" >/dev/null || die "workflow input is missing"
  grep -F 'validate-hardware-canary.py evidence' "${WORKFLOW}" >/dev/null || die "workflow does not reuse the validator"
  grep -F 'validate-hardware-canary.py candidate-result' "${WORKFLOW}" >/dev/null || die "workflow does not validate the candidate result artifact"
  grep -F 'CODEX VibeTV Hardware Canary' "${WORKFLOW}" >/dev/null || die "workflow status context is missing"
  grep -F -- '--confirm-render-visible' "${CANARY}" >/dev/null || die "canary lacks explicit visual confirmation"
  grep -F -- '--confirm-power-cycle-10s' "${CANARY}" >/dev/null || die "canary lacks explicit power-cycle confirmation"
  grep -F 'write_evidence unknown' "${CANARY}" >/dev/null || die "canary lacks unknown-write evidence"
  grep -F "role']=='companion'" "${CANARY}" >/dev/null || die "canary does not select the candidate companion role"
  grep -F 'esp8266-backup.sh' "${CANARY}" >/dev/null || die "canary does not create the required full USB backup"
  grep -F 'vibetv-hardware-canary' "${WORKFLOW}" >/dev/null || die "workflow uses the wrong evidence artifact name"
  grep -F 'semver_compare' "${CANARY}" >/dev/null || die "canary does not compare firmware versions as SemVer"
  grep -F 'candidate-firmware-manifest.json' "${CANARY}" >/dev/null || die "canary does not create a local absolute firmware manifest"
  grep -F -- '--resume' "${CANARY}" >/dev/null || die "canary lacks the read-only power-cycle resume phase"
  grep -F 'sent frame ->' "${CANARY}" >/dev/null || die "canary does not require daemon frame-send evidence"
  grep -F 'headBranch' "${WORKFLOW}" >/dev/null || die "workflow does not check candidate main branch"
  grep -F 'workflow_dispatch' "${WORKFLOW}" >/dev/null || die "workflow does not check candidate dispatch event"
  grep -F 'actor' "${WORKFLOW}" >/dev/null || die "workflow does not bind evidence actor"
  grep -F 'serve/candidate' "${CANARY}" >/dev/null || die "canary does not use a separate serve symlink"
  grep -F 'candidateRunId' "${CANARY}" >/dev/null || die "pending state does not retain candidate run identity"
  grep -F 'gh api user --jq .login' "${CANARY}" >/dev/null || die "canary does not resolve a GitHub actor"
  grep -F 'wait_for_resume_health' "${CANARY}" >/dev/null || die "resume does not bound hello and health polling"
  grep -F 'daemon --transport wifi --target "$TARGET" --once' "${CANARY}" >/dev/null || die "resume does not rerun the candidate daemon"
}

main "$@"
