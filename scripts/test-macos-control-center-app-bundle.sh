#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TMP_TEST_DIR=""

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

assert_file() {
  [[ -f "$1" ]] || die "missing file: $1"
}

cleanup() {
  if [[ -n "$TMP_TEST_DIR" ]]; then
    rm -rf "$TMP_TEST_DIR"
  fi
}

test_signing_safety_helpers() (
  set --
  # shellcheck source=sign-notarize-macos-control-center.sh
  source "${ROOT}/scripts/sign-notarize-macos-control-center.sh"

  local test_dir
  test_dir="$(mktemp -d "${TMPDIR:-/tmp}/vibetv-signing-safety.XXXXXX")"
  trap 'rm -rf "$test_dir"' EXIT
  mkdir -p "$test_dir/Test.app"

  cat > "$test_dir/internal-xprotect.json" <<'JSON'
{
  "output": [
    {
      "SyspolicyCheckAdditionalInformation": "",
      "SyspolicyCheckAdvice": "Please take a sysdiagnose and file a Feedback using Feedback Assistant.app.",
      "SyspolicyCheckDocumentationLink": "",
      "SyspolicyCheckErrorLevel": "Fatal",
      "SyspolicyCheckLongError": "One or more files in your application triggered an Xprotect error.",
      "SyspolicyCheckShortError": "Internal Xprotect Error"
    }
  ]
}
JSON
  cp "$test_dir/internal-xprotect.json" "$test_dir/internal-extra-root.json"
  plutil -insert additionalFailure -string "must remain fatal" \
    "$test_dir/internal-extra-root.json"
  cp "$test_dir/internal-xprotect.json" "$test_dir/internal-wrong-type.json"
  plutil -replace output.0.SyspolicyCheckAdditionalInformation -json '{}' \
    "$test_dir/internal-wrong-type.json"
  cat > "$test_dir/internal-plus-structure.json" <<'JSON'
{
  "output": [
    {
      "SyspolicyCheckAdditionalInformation": "",
      "SyspolicyCheckAdvice": "Please take a sysdiagnose and file a Feedback using Feedback Assistant.app.",
      "SyspolicyCheckDocumentationLink": "",
      "SyspolicyCheckErrorLevel": "Fatal",
      "SyspolicyCheckLongError": "One or more files in your application triggered an Xprotect error.",
      "SyspolicyCheckShortError": "Internal Xprotect Error"
    },
    {
      "SyspolicyCheckAdditionalInformation": "",
      "SyspolicyCheckAdvice": "Move executable code out of Resources.",
      "SyspolicyCheckDocumentationLink": "",
      "SyspolicyCheckErrorLevel": "Fatal",
      "SyspolicyCheckLongError": "Resources directory contains Mach-o binaries.",
      "SyspolicyCheckShortError": "Incorrect Bundle Structure"
    }
  ]
}
JSON
  cat > "$test_dir/generic-error.json" <<'JSON'
{
  "output": [
    {
      "SyspolicyCheckAdditionalInformation": "",
      "SyspolicyCheckAdvice": "Fix the bundle before submission.",
      "SyspolicyCheckDocumentationLink": "",
      "SyspolicyCheckErrorLevel": "Fatal",
      "SyspolicyCheckLongError": "Resources directory contains Mach-o binaries.",
      "SyspolicyCheckShortError": "Incorrect Bundle Structure"
    }
  ]
}
JSON
  printf '%s\n' '{"output":[]}' > "$test_dir/success.json"

  MOCK_REPORT="$test_dir/internal-xprotect.json"
  MOCK_EXIT=70
  MOCK_STDERR=""
  syspolicy_check() {
    cat "$MOCK_REPORT"
    [[ -z "$MOCK_STDERR" ]] || printf '%s\n' "$MOCK_STDERR" >&2
    return "$MOCK_EXIT"
  }

  APP_DIR="$test_dir/Test.app"
  WORK_DIR="$test_dir/work-allowed"
  ALLOW_INTERNAL_XPROTECT_PREFLIGHT_ERROR=1
  mkdir -p "$WORK_DIR"
  run_notary_submission_preflight > /dev/null 2> "$test_dir/allowed.stderr" \
    || die "exact validation-only internal XProtect report must continue to notarytool"
  grep -qF "continuing this validation-only run" "$test_dir/allowed.stderr" \
    || die "allowed internal XProtect report must emit a validation-only warning"

  WORK_DIR="$test_dir/work-disabled"
  ALLOW_INTERNAL_XPROTECT_PREFLIGHT_ERROR=0
  mkdir -p "$WORK_DIR"
  if run_notary_submission_preflight > /dev/null 2>&1; then
    die "internal XProtect report must stay fatal unless validation-only explicitly enables it"
  fi

  WORK_DIR="$test_dir/work-combined"
  ALLOW_INTERNAL_XPROTECT_PREFLIGHT_ERROR=1
  MOCK_REPORT="$test_dir/internal-plus-structure.json"
  mkdir -p "$WORK_DIR"
  if run_notary_submission_preflight > /dev/null 2>&1; then
    die "internal XProtect report must not hide an additional bundle-structure failure"
  fi

  WORK_DIR="$test_dir/work-extra-root"
  MOCK_REPORT="$test_dir/internal-extra-root.json"
  mkdir -p "$WORK_DIR"
  if run_notary_submission_preflight > /dev/null 2>&1; then
    die "internal XProtect exception must reject additional root diagnostics"
  fi

  WORK_DIR="$test_dir/work-wrong-type"
  MOCK_REPORT="$test_dir/internal-wrong-type.json"
  mkdir -p "$WORK_DIR"
  if run_notary_submission_preflight > /dev/null 2>&1; then
    die "internal XProtect exception must reject fields with unexpected types"
  fi

  WORK_DIR="$test_dir/work-stderr"
  MOCK_REPORT="$test_dir/internal-xprotect.json"
  MOCK_STDERR="unexpected secondary diagnostic"
  mkdir -p "$WORK_DIR"
  if run_notary_submission_preflight > /dev/null 2>&1; then
    die "internal XProtect exception must reject additional stderr diagnostics"
  fi
  MOCK_STDERR=""

  WORK_DIR="$test_dir/work-generic"
  MOCK_REPORT="$test_dir/generic-error.json"
  mkdir -p "$WORK_DIR"
  if run_notary_submission_preflight > /dev/null 2>&1; then
    die "generic syspolicy_check failures must remain fatal"
  fi

  WORK_DIR="$test_dir/work-wrong-exit"
  MOCK_REPORT="$test_dir/internal-xprotect.json"
  MOCK_EXIT=1
  mkdir -p "$WORK_DIR"
  if run_notary_submission_preflight > /dev/null 2>&1; then
    die "internal XProtect exception must require syspolicy_check exit 70"
  fi

  WORK_DIR="$test_dir/work-success"
  MOCK_REPORT="$test_dir/success.json"
  MOCK_EXIT=0
  mkdir -p "$WORK_DIR"
  run_notary_submission_preflight > /dev/null 2>&1 \
    || die "successful syspolicy_check preflight must remain successful"

  cat > "$test_dir/notary-accepted-empty.json" <<'JSON'
{"status":"Accepted","issues":[]}
JSON
  cat > "$test_dir/notary-accepted-null.json" <<'JSON'
{"status":"Accepted","issues":null}
JSON
  cat > "$test_dir/notary-accepted-warning.json" <<'JSON'
{"status":"Accepted","issues":[{"severity":"warning","message":"Review this warning."}]}
JSON
  cat > "$test_dir/notary-invalid.json" <<'JSON'
{"status":"Invalid","issues":[]}
JSON

  validate_accepted_notary_log "$test_dir/notary-accepted-empty.json" > /dev/null
  validate_accepted_notary_log "$test_dir/notary-accepted-null.json" > /dev/null
  if (validate_accepted_notary_log "$test_dir/notary-accepted-warning.json" > /dev/null 2>&1); then
    die "Accepted notarization logs with warnings must remain fatal"
  fi
  if (validate_accepted_notary_log "$test_dir/notary-invalid.json" > /dev/null 2>&1); then
    die "non-Accepted notarization logs must remain fatal"
  fi
)

main() {
  local tmp app dmg stage sign_output
  tmp="$(mktemp -d "${TMPDIR:-/tmp}/vibetv-macos-test.XXXXXX")"
  TMP_TEST_DIR="$tmp"
  trap cleanup EXIT

  app="${tmp}/VibeTV Control Center.app"
  dmg="${tmp}/VibeTV-Control-Center-v1.2.3.dmg"
  stage="${tmp}/dmg-stage"

  "${ROOT}/scripts/build-macos-control-center-app.sh" \
    --dry-run \
    --version "1.2.3" \
    --build "146" \
    --output "$app" >/dev/null

  assert_file "${app}/Contents/Info.plist"
  [[ -x "${app}/Contents/MacOS/VibeTVControlCenter" ]] \
    || die "app executable is missing or not executable"
  [[ -d "${app}/Contents/Resources/control-center" ]] \
    || die "Control Center resource folder is missing"
  [[ -x "${app}/Contents/Helpers/codexbar-display" ]] \
    || die "bundled Companion helper is missing or not executable"
  [[ ! -e "${app}/Contents/Resources/companion" ]] \
    || die "Mach-O helpers must not be stored in the Resources directory"
  assert_file "${app}/Contents/Resources/VibeTVControlCenter.icns"
  assert_file "${app}/Contents/Library/LaunchAgents/shop.vibetv.control-center.runtime.plist"

  python3 - \
    "${app}/Contents/Info.plist" \
    "${app}/Contents/Library/LaunchAgents/shop.vibetv.control-center.runtime.plist" \
    "${ROOT}/macos/VibeTVControlCenter/main.swift" <<'PY'
import plistlib
import sys

with open(sys.argv[1], "rb") as f:
    plist = plistlib.load(f)

expected = {
    "CFBundleIdentifier": "shop.vibetv.control-center",
    "CFBundleName": "VibeTV Control Center",
    "CFBundleDisplayName": "VibeTV Control Center",
    "CFBundleExecutable": "VibeTVControlCenter",
    "CFBundleIconFile": "VibeTVControlCenter.icns",
    "CFBundleShortVersionString": "1.2.3",
    "CFBundleVersion": "146",
    "CFBundlePackageType": "APPL",
}

for key, value in expected.items():
    actual = plist.get(key)
    if actual != value:
        raise SystemExit(f"{key}: expected {value!r}, got {actual!r}")

if plist.get("NSAppTransportSecurity", {}).get("NSAllowsLocalNetworking") is not True:
    raise SystemExit("NSAllowsLocalNetworking must be true")

url_types = plist.get("CFBundleURLTypes")
expected_url_types = [{
    "CFBundleTypeRole": "Editor",
    "CFBundleURLName": "shop.vibetv.control-center",
    "CFBundleURLSchemes": ["vibetv"],
}]
if url_types != expected_url_types:
    raise SystemExit(
        f"CFBundleURLTypes: expected {expected_url_types!r}, got {url_types!r}"
    )

with open(sys.argv[2], "rb") as f:
    agent = plistlib.load(f)

expected_agent_values = {
    "Label": "shop.vibetv.control-center.runtime",
    "BundleProgram": "Contents/Helpers/codexbar-display",
    "RunAtLoad": True,
    "KeepAlive": True,
    "ProcessType": "Background",
    "ThrottleInterval": 10,
}
for key, value in expected_agent_values.items():
    actual = agent.get(key)
    if actual != value:
        raise SystemExit(f"LaunchAgent {key}: expected {value!r}, got {actual!r}")

expected_arguments = [
    "codexbar-display",
    "daemon",
    "--transport",
    "wifi",
    "--target",
    "http://vibetv.local",
    "--interval",
    "30s",
    "--api-addr",
    "127.0.0.1:47832",
    "--api-dev-origin",
    "http://127.0.0.1:47832",
]
if agent.get("ProgramArguments") != expected_arguments:
    raise SystemExit(
        "LaunchAgent must run the persistent frame-sending daemon with its local API"
    )

environment = agent.get("EnvironmentVariables", {})
if environment.get("VIBETV_DISABLE_MAC_APP_SELF_UPDATE") != "1":
    raise SystemExit(
        "DMG runtime must disable the legacy Terminal Mac App updater"
    )

with open(sys.argv[3], encoding="utf-8") as f:
    source = f.read()

required_source = [
    "import ServiceManagement",
    "SMAppService.agent(plistName: runtimeLaunchAgentPlistName)",
    "try runtimeService.register()",
    "runtimeService.unregister(completionHandler:",
    "runtimeServiceNeedsRefresh(",
    'runtimeLaunchAgentLabel = "shop.vibetv.control-center.runtime"',
    'runtimeStatusURLString = "http://127.0.0.1:47832/v1/status"',
    "let health = await waitForHealthyRuntime(expectedVersion: expectedVersion)",
    "let ownership = verifyRuntimeListenerOwnership()",
    'executable: "/usr/sbin/lsof"',
    '"-iTCP@127.0.0.1:47832"',
    '"-sTCP:LISTEN"',
    "else if !(await unregisterBundledRuntimeService())",
    "rollbackToLegacyAgents(",
    "restoreMigrationArtifacts(",
    'appendingPathComponent("VibeTV Control Center.app"',
    "setDefaultApplication(",
    "toOpenURLsWithScheme: controlCenterURLScheme",
    "func application(_ application: NSApplication, open urls: [URL])",
    "urlRouter.receive(urls)",
    "decidePolicyFor navigationAction: WKNavigationAction",
    "navigationAction.navigationType == .linkActivated",
    "isApprovedDMGDownloadURL(url)",
    "decisionHandler(.cancel)",
    "NSWorkspace.shared.open(url)",
]
for snippet in required_source:
    if snippet not in source:
        raise SystemExit(f"native app is missing required behavior: {snippet}")

registration = source.find("guard await ensureBundledRuntimeServiceRegistered()")
stop_legacy = source.find("if !stopLegacyLaunchAgents(legacyStates)")
health_gate = source.find("let health = await waitForHealthyRuntime")
legacy_app_migration = source.find(
    "let migratedLegacyApps = await migrateLegacyAppsAfterHealthyRuntime",
    health_gate,
)
persist_version = source.find("recordCurrentRuntimeBundleVersion()", health_gate)
if not (
    0 <= registration < stop_legacy < health_gate < legacy_app_migration < persist_version
):
    raise SystemExit(
        "native app must register, stop legacy, pass health, migrate old apps, then persist"
    )

health_method = source[
    source.find("private func waitForHealthyRuntime("):
    source.find("private func currentCompanionVersion()")
]
if health_method.find("evaluateRuntimeHealth(") > health_method.find(
    "verifyRuntimeListenerOwnership()"
):
    raise SystemExit(
        "HTTP health must be evaluated before listener ownership is accepted"
    )

register_method = source[
    source.find("private func registerBundledRuntimeService()"):
    source.find("private func unregisterBundledRuntimeService()")
]
if "recordCurrentRuntimeBundleVersion" in register_method:
    raise SystemExit(
        "SMAppService enabled status must not persist a version before the HTTP health gate"
    )

for forbidden in [
    "companionProcess",
    "func applicationShouldTerminate(",
    "func applicationWillTerminate(",
]:
    if forbidden in source:
        raise SystemExit(
            f"native app must not tie the persistent runtime to UI termination: {forbidden}"
        )
PY

  if [[ "$(uname -s)" == "Darwin" ]] && command -v swiftc >/dev/null 2>&1; then
    swiftc \
      -D VIBETV_CONTROL_CENTER_TESTING \
      -swift-version 6 \
      -strict-concurrency=complete \
      -warnings-as-errors \
      "${ROOT}/macos/VibeTVControlCenter/main.swift" \
      "${ROOT}/macos/VibeTVControlCenter/URLSchemeTests.swift" \
      -o "${tmp}/url-scheme-tests" \
      -framework Cocoa \
      -framework ServiceManagement \
      -framework WebKit
    "${tmp}/url-scheme-tests"
  fi

  "${ROOT}/scripts/build-macos-control-center-dmg.sh" \
    --dry-run \
    --app "$app" \
    --output "$dmg" \
    --staging-dir "$stage" >/dev/null

  [[ -d "${stage}/VibeTV Control Center.app" ]] \
    || die "DMG staging folder is missing the app bundle"
  [[ -L "${stage}/Applications" ]] \
    || die "DMG staging folder is missing the Applications symlink"
  [[ "$(readlink "${stage}/Applications")" == "/Applications" ]] \
    || die "Applications symlink must point to /Applications"
  [[ ! -f "$dmg" ]] \
    || die "DMG dry-run must not create a real DMG"

  sign_output="$("${ROOT}/scripts/sign-notarize-macos-control-center.sh" \
    --dry-run \
    --app "$app" \
    --dmg "$dmg" 2>&1)"

  for secret in \
    APPLE_TEAM_ID \
    APPLE_SIGNING_CERTIFICATE_P12_BASE64 \
    APPLE_SIGNING_CERTIFICATE_PASSWORD \
    APPLE_NOTARY_KEY_ID \
    APPLE_NOTARY_ISSUER_ID \
    APPLE_NOTARY_KEY_P8_BASE64
  do
    assert_contains "$sign_output" "$secret" "signing dry-run must name missing ${secret}"
  done

  assert_contains "$sign_output" "codesign --force --options runtime" \
    "signing dry-run must show hardened-runtime codesign"
  assert_contains "$sign_output" "${app}/Contents/Helpers/codexbar-display" \
    "signing dry-run must sign the helper from the standard code directory"
  if [[ "$sign_output" == *"Contents/Resources/companion"* ]]; then
    die "signing dry-run must not treat Resources as a Mach-O code directory"
  fi
  assert_contains "$sign_output" "xcrun notarytool submit" \
    "signing dry-run must show notarytool submission"
  assert_contains "$sign_output" "xcrun stapler staple" \
    "signing dry-run must show stapler"
  assert_contains "$sign_output" "spctl --assess" \
    "signing dry-run must show Gatekeeper assessment"

  grep -qF "com.codexbar-display.daemon" "${ROOT}/macos/VibeTVControlCenter/main.swift" \
    || die "native app shell must detect the old LaunchAgent"
  grep -qF "migration-backups" "${ROOT}/macos/VibeTVControlCenter/main.swift" \
    || die "native app shell must back up old LaunchAgents during migration"
  grep -qF "SMAppService.agent" "${ROOT}/macos/VibeTVControlCenter/main.swift" \
    || die "native app shell must manage its persistent runtime with SMAppService"

  grep -qF "test-macos-control-center-app-bundle.sh" "${ROOT}/.github/workflows/ci.yml" \
    || die "CI must run the macOS app/DMG dry-run test"
  ! grep -Eq "brew (tap|publish|pr|create)|Homebrew/homebrew" "${ROOT}/.github/workflows/release.yml" \
    || die "release workflow must not publish Homebrew assets"
  grep -qF ".dmg" "${ROOT}/docs/operator-runbook.md" \
    || die "operator runbook must include DMG release readiness"

  test_signing_safety_helpers

  printf 'macOS Control Center app bundle prep test passed\n'
}

main "$@"
