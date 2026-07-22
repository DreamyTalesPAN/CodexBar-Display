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
      "SyspolicyCheckErrorLevel": "Fatal",
      "SyspolicyCheckShortError": "Internal Xprotect Error",
      "SyspolicyCheckAdditionalInformation": "",
      "SyspolicyCheckDocumentationLink": "",
      "SyspolicyCheckAdvice": "Please take a sysdiagnose and file a Feedback using Feedback Assistant.app.",
      "SyspolicyCheckLongError": "One or more files in your application triggered an Xprotect error."
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

test_outer_dmg_ticket_policy_helper() (
  set --
  # shellcheck source=verify-macos-control-center-dmg.sh
  source "${ROOT}/scripts/verify-macos-control-center-dmg.sh"

  local test_dir
  test_dir="$(mktemp -d "${TMPDIR:-/tmp}/vibetv-ticket-policy.XXXXXX")"
  TICKET_TEST_DIR="$test_dir"
  trap 'rm -rf "$TICKET_TEST_DIR"' EXIT
  MOUNTED_APP="$test_dir/VibeTV Control Center.app"
  mkdir -p "$MOUNTED_APP"

  cat > "$test_dir/exact.json" <<'JSON'
{
  "output": [
    {
      "SyspolicyCheckErrorLevel": "Fatal",
      "SyspolicyCheckShortError": "Notary Ticket Missing",
      "SyspolicyCheckAdditionalInformation": "",
      "SyspolicyCheckDocumentationLink": "https://developer.apple.com/documentation/security/notarizing_macos_software_before_distribution.",
      "SyspolicyCheckAdvice": "If this application has already been uploaded to the Apple notary service, please make sure to attach the ticket with the `stapler staple` command. If not, please upload to the Apple notary service using Xcode or via `notarytool`. ",
      "SyspolicyCheckLongError": "A Notarization ticket is not stapled to this application.",
      "SyspolicyCheckErrorFile": "__MOUNTED_APP__"
    }
  ]
}
JSON
  python3 - "$test_dir/exact.json" "$test_dir" "$MOUNTED_APP" <<'PY'
import copy
import json
import os
import sys

source_path, target_dir, mounted_app = sys.argv[1:]
with open(source_path, encoding="utf-8") as source_file:
    exact = json.load(source_file)


def write(name, value):
    with open(os.path.join(target_dir, name), "w", encoding="utf-8") as output_file:
        json.dump(value, output_file)


exact["output"][0]["SyspolicyCheckErrorFile"] = mounted_app
write("exact.json", exact)

basename = copy.deepcopy(exact)
basename["output"][0]["SyspolicyCheckErrorFile"] = os.path.basename(mounted_app)
write("basename.json", basename)

combined = copy.deepcopy(exact)
combined["output"].append(copy.deepcopy(combined["output"][0]))
write("combined.json", combined)

extra_root = copy.deepcopy(exact)
extra_root["additionalFailure"] = "must remain fatal"
write("extra-root.json", extra_root)

extra_field = copy.deepcopy(exact)
extra_field["output"][0]["UnexpectedField"] = "must remain fatal"
write("extra-field.json", extra_field)

wrong_type = copy.deepcopy(exact)
wrong_type["output"][0]["SyspolicyCheckAdditionalInformation"] = {}
write("wrong-type.json", wrong_type)

wrong_file = copy.deepcopy(exact)
wrong_file["output"][0]["SyspolicyCheckErrorFile"] = "/tmp/Other.app"
write("wrong-file.json", wrong_file)

wrong_relative_file = copy.deepcopy(exact)
wrong_relative_file["output"][0]["SyspolicyCheckErrorFile"] = (
    "Other/VibeTV Control Center.app"
)
write("wrong-relative-file.json", wrong_relative_file)

value_mutations = {
    "wrong-additional.json": (
        "SyspolicyCheckAdditionalInformation",
        "unexpected detail",
    ),
    "wrong-advice.json": ("SyspolicyCheckAdvice", "Different advice."),
    "wrong-documentation.json": (
        "SyspolicyCheckDocumentationLink",
        "https://example.invalid/notarization",
    ),
    "wrong-level.json": ("SyspolicyCheckErrorLevel", "Warning"),
    "wrong-long-error.json": ("SyspolicyCheckLongError", "Different error."),
    "wrong-short-error.json": ("SyspolicyCheckShortError", "Different error"),
}
for name, (key, value) in value_mutations.items():
    mutated = copy.deepcopy(exact)
    mutated["output"][0][key] = value
    write(name, mutated)

with open(os.path.join(target_dir, "duplicate-key.json"), "w", encoding="utf-8") as output_file:
    duplicate = json.dumps(exact)
    marker = '"SyspolicyCheckErrorLevel": "Fatal"'
    duplicate = duplicate.replace(marker, f"{marker}, {marker}", 1)
    output_file.write(f"{duplicate}\n")

with open(os.path.join(target_dir, "malformed.json"), "w", encoding="utf-8") as output_file:
    output_file.write('{"output":[')

write("success.json", {"output": []})
PY

  MOCK_POLICY_REPORT="$test_dir/exact.json"
  MOCK_POLICY_EXIT=70
  MOCK_POLICY_STDERR=""
  syspolicy_check() {
    cat "$MOCK_POLICY_REPORT"
    [[ -z "$MOCK_POLICY_STDERR" ]] || printf '%s\n' "$MOCK_POLICY_STDERR" >&2
    return "$MOCK_POLICY_EXIT"
  }

  SPCTL_LOG="$test_dir/spctl.log"
  MOCK_SPCTL_EXIT=0
  MOCK_SPCTL_OUTPUT="${MOUNTED_APP}: accepted
source=Notarized Developer ID"
  spctl() {
    printf 'called\n' >> "$SPCTL_LOG"
    printf '%s\n' "$MOCK_SPCTL_OUTPUT" >&2
    return "$MOCK_SPCTL_EXIT"
  }

  verify_mounted_app_gatekeeper > /dev/null 2> "$test_dir/exact.stderr" \
    || die "exact outer-DMG ticket diagnostic must continue to mounted-app Gatekeeper"
  [[ "$(wc -l < "$SPCTL_LOG" | tr -d ' ')" == "1" ]] \
    || die "mounted-app Gatekeeper must run after the exact ticket diagnostic"
  grep -qF "already validated outer DMG" "$test_dir/exact.stderr" \
    || die "outer-DMG ticket diagnostic must emit a narrow warning"

  MOCK_POLICY_REPORT="$test_dir/basename.json"
  run_mounted_app_distribution_policy_check > /dev/null 2>&1 \
    || die "the exact app basename from older syspolicy output must remain supported"

  : > "$SPCTL_LOG"
  MOCK_SPCTL_EXIT=1
  MOCK_POLICY_REPORT="$test_dir/exact.json"
  if verify_mounted_app_gatekeeper > /dev/null 2>&1; then
    die "mounted-app Gatekeeper failure must remain fatal after the ticket warning"
  fi
  [[ "$(wc -l < "$SPCTL_LOG" | tr -d ' ')" == "1" ]] \
    || die "failing mounted-app Gatekeeper assessment must still be executed"
  MOCK_SPCTL_EXIT=0

  : > "$SPCTL_LOG"
  MOCK_POLICY_REPORT="$test_dir/extra-field.json"
  if verify_mounted_app_gatekeeper > /dev/null 2>&1; then
    die "non-exact ticket diagnostics must fail the complete mounted-app gate"
  fi
  [[ ! -s "$SPCTL_LOG" ]] \
    || die "mounted-app Gatekeeper must not run after a policy-check failure"

  for fixture in \
    combined \
    extra-root \
    extra-field \
    wrong-type \
    wrong-file \
    wrong-relative-file \
    wrong-additional \
    wrong-advice \
    wrong-documentation \
    wrong-level \
    wrong-long-error \
    wrong-short-error \
    duplicate-key \
    malformed
  do
    MOCK_POLICY_REPORT="$test_dir/${fixture}.json"
    if run_mounted_app_distribution_policy_check > /dev/null 2>&1; then
      die "ticket policy fixture ${fixture} must remain fatal"
    fi
  done

  MOCK_POLICY_REPORT="$test_dir/exact.json"
  MOCK_POLICY_STDERR="unexpected secondary diagnostic"
  if run_mounted_app_distribution_policy_check > /dev/null 2>&1; then
    die "ticket policy exception must reject non-empty stderr"
  fi
  MOCK_POLICY_STDERR=""

  MOCK_POLICY_EXIT=1
  if run_mounted_app_distribution_policy_check > /dev/null 2>&1; then
    die "ticket policy exception must require exit 70"
  fi

  MOCK_POLICY_EXIT=0
  MOCK_POLICY_REPORT="$test_dir/success.json"
  : > "$SPCTL_LOG"
  verify_mounted_app_gatekeeper > /dev/null 2>&1 \
    || die "successful syspolicy_check must continue to mounted-app Gatekeeper"
  [[ "$(wc -l < "$SPCTL_LOG" | tr -d ' ')" == "1" ]] \
    || die "mounted-app Gatekeeper must run after successful syspolicy_check"

  MOCK_SPCTL_OUTPUT="${MOUNTED_APP}: accepted
source=Developer ID"
  if verify_mounted_app_gatekeeper > /dev/null 2>&1; then
    die "mounted app must be accepted specifically as Notarized Developer ID"
  fi

  : > "$SPCTL_LOG"
  mktemp() {
    return 1
  }
  if verify_mounted_app_gatekeeper > /dev/null 2>&1; then
    die "policy work-directory creation failure must remain fatal"
  fi
  [[ ! -s "$SPCTL_LOG" ]] \
    || die "mounted-app Gatekeeper must not run without a policy work directory"
)

main() {
  local tmp app preview_app dmg stage sign_output
  tmp="$(mktemp -d "${TMPDIR:-/tmp}/vibetv-macos-test.XXXXXX")"
  TMP_TEST_DIR="$tmp"
  trap cleanup EXIT

  app="${tmp}/VibeTV Control Center.app"
  preview_app="${tmp}/VibeTV Control Center Preview.app"
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
  assert_file "${app}/Contents/Resources/CodexBar/CodexBar-macos-universal-0.44.0.zip"
  assert_file "${app}/Contents/Resources/CodexBar/CodexBar-v0.44.0.manifest.json"
  assert_file "${app}/Contents/Resources/CodexBar/CodexBar-LICENSE.txt"
  assert_file "${app}/Contents/Library/LaunchAgents/shop.vibetv.control-center.runtime.plist"
  assert_file "${app}/Contents/Frameworks/Sparkle.framework/README.txt"

  "${ROOT}/scripts/build-macos-control-center-app.sh" \
    --dry-run \
    --local-preview \
    --version "1.2.3-preview.146" \
    --build "146" \
    --output "$preview_app" >/dev/null
  [[ "$(plutil -extract VibeTVLocalPreviewRuntime raw -o - "${preview_app}/Contents/Info.plist")" == "true" ]] \
    || die "local preview bundle must opt into its isolated preview runtime"

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
    "LSMinimumSystemVersion": "14.0",
    "SUEnableAutomaticChecks": False,
    "SUFeedURL": "https://github.com/DreamyTalesPAN/CodexBar-Display/releases/latest/download/appcast.xml",
    "SUPublicEDKey": "2txeIAd+ofTbffzPR5hy5J4lvGX8LGclIdG82es1qPA=",
    "VibeTVLocalPreviewRuntime": False,
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
if environment.get("CODEXBAR_DISPLAY_STREAM_LAUNCH_AGENT_LABEL") != agent.get("Label"):
    raise SystemExit(
        "DMG runtime must expose its LaunchAgent label to the Companion API"
    )
if environment.get("VIBETV_DISABLE_MAC_APP_SELF_UPDATE") != "1":
    raise SystemExit(
        "DMG runtime must disable the legacy Terminal Mac App updater"
    )
if environment.get("VIBETV_MAC_APP_VERSION") != "1.2.3":
    raise SystemExit("DMG runtime must report its containing Mac App version")
if environment.get("VIBETV_MAC_APP_BUILD") != "146":
    raise SystemExit("DMG runtime must report its containing Mac App build")

with open(sys.argv[3], encoding="utf-8") as f:
    source = f.read()

prepare_start = source.index("private func prepareCompanion()")
prepare_end = source.index(
    "private func ensureBundledRuntimeServiceRegistered()",
    prepare_start,
)
prepare_source = source[prepare_start:prepare_end]
stop_legacy = prepare_source.index("stopLegacyLaunchAgents(legacyStates)")
register_runtime = prepare_source.index("ensureBundledRuntimeServiceRegistered()")
if stop_legacy > register_runtime:
    raise SystemExit(
        "native app must stop legacy display writers before registering the new LaunchAgent"
    )

required_source = [
    "import ServiceManagement",
    "import CryptoKit",
    "import Sparkle",
    "SPUStandardUpdaterController(",
    "SPUUpdaterDelegate",
    'isCheckForUpdatesURL(url)',
    'pendingNativeUpdateFileName = "pending-native-update.json"',
    "SMAppService.agent(plistName: runtimeLaunchAgentPlistName)",
    "try runtimeService.register()",
    "runtimeService.unregister(completionHandler:",
    "runtimeServiceNeedsRefresh(",
    'previewRuntimeLaunchAgentLabel =',
    'localPreviewRuntimeInfoKey = "VibeTVLocalPreviewRuntime"',
    'registerLocalPreviewRuntimeService()',
    'unregisterLocalPreviewRuntimeService()',
    '"CODEXBAR_DISPLAY_STREAM_LAUNCH_AGENT_LABEL":',
    'runtimeLaunchAgentLabel = "shop.vibetv.control-center.runtime"',
    'runtimeHealthURLString = "http://127.0.0.1:47832/v1/runtime-health"',
    'nativeControlCenterUserAgentPrefix = "VibeTVControlCenter/"',
    "webView.customUserAgent = nativeControlCenterUserAgent(",
    "timeout: runtimeInitialHealthTimeout",
    "shouldRetryRuntimeRegistration(",
    "shouldRunRuntimeValidationUnregister(",
    '"--vibetv-validation-unregister-runtime"',
    '"VIBETV_RUNTIME_VALIDATION_UNREGISTER"',
    "CODEX_RUNTIME_UNREGISTER_OK label=",
    "let ownership = verifyRuntimeListenerOwnership()",
    'executable: "/usr/sbin/lsof"',
    '"-iTCP@127.0.0.1:47832"',
    '"-sTCP:LISTEN"',
    'URL(fileURLWithPath: "/Library/LaunchAgents"',
    'launchctlExitStatus(["disable", service])',
    'launchctlExitStatus(["bootout", service])',
    'launchctlExitStatus(["enable", service])',
    'arguments: ["print-disabled", "gui/\\(getuid())"]',
    "descriptor.migrationPlistURL",
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
    "requiresApplicationInstallation(Bundle.main.bundleURL)",
    "presentInstallationRequiredAlert()",
    "RuntimePreparationOutcome",
    "pendingNativeUpdateBlocksBundle(",
    "pendingNativeUpdateIsExpired(",
    "discardMismatchedPendingNativeUpdate()",
    "presentInstallationStatus(",
    "@objc private func createNativeSupportReport()",
    '"reportType": "native_installation"',
    '"controlCenterDiagnostics": decodedJSONOrProcessOutput(companionDiagnostics)',
    '"recentLogs": recentTextFiles(',
    '"backgroundItems": filteredBackgroundItems(',
    'Task.detached(priority: .userInitiated)',
    'withJSONObject: redactReportValue(report)',
    '"--max-time", "40"',
    'title: "Create report"',
    'title: "Starting Control Center"',
    "retryTitle: status.retryTitle",
    'codexBarBundleIdentifier = "com.steipete.codexbar"',
    'codexBarPinnedVersion = "0.44.0"',
    'codexBarMinimumCompatibleVersion = "0.23.0"',
    'codexBarPinnedTeamIdentifier = "Y5PE65HELJ"',
    'CodexBar-macos-universal-0.44.0.zip',
    'bootstrapCodexBar()',
    'arguments: ["--verify", "--deep", "--strict", "--verbose=2", appURL.path]',
    'arguments: ["--assess", "--type", "execute", "--verbose=4", appURL.path]',
    'arguments: ["-x", "-k", archiveURL.path, stagingURL.path]',
    'try fileManager.moveItem(at: stagedAppURL, to: targetURL)',
    'configuration.activates = false',
    'environment["CODEXBAR_CONFIG"] = configURL.path',
    '[.posixPermissions: 0o700]',
    '[.posixPermissions: 0o600]',
    'title: "Installation needs attention"',
    "activeNavigation = webView?.load(",
    ".reloadIgnoringLocalCacheData",
    'alert.addButton(withTitle: "Open Applications")',
    'alert.addButton(withTitle: "Quit")',
    'alert.addButton(withTitle: "Create report")',
]
for snippet in required_source:
    if snippet not in source:
        raise SystemExit(f"native app is missing required behavior: {snippet}")

if "support.isHidden = !failed" in source:
    raise SystemExit("Create report must remain visible on every native setup screen")

launch_start = source.find("func applicationDidFinishLaunching(")
launch_end = source.find("func application(_ application:", launch_start)
launch_method = source[launch_start:launch_end]
install_guard = launch_method.find("guard !installationRequired else")
install_alert = launch_method.find("presentInstallationRequiredAlert()", install_guard)
sparkle_start = launch_method.find("_ = updaterController", install_guard)
runtime_start = launch_method.find("Task {", install_guard)
runtime_start = launch_method.find("startRuntimePreparation()", install_guard)
if not (0 <= install_guard < install_alert < sparkle_start < runtime_start):
    raise SystemExit(
        "native app must stop at the install dialog before starting Sparkle, the runtime, or WebView"
    )

prepare_start = source.find("private func startRuntimePreparation()")
prepare_end = source.find("@objc private func retryRuntimePreparation()", prepare_start)
preparation_method = source[prepare_start:prepare_end]
status_start = preparation_method.find("presentInstallationStatus(")
preflight_call = preparation_method.find("await self?.performLocalNetworkPrivacyPreflight()")
preparation_task = preparation_method.find("preparationTask = Task")
prepare_runtime = preparation_method.find(
    "let outcome = await self.prepareCompanionWithAutomaticCodexBarRepair()"
)
native_case = preparation_method.find("case .nativeRuntimeReady:", prepare_runtime)
webview_after_verify = preparation_method.find("self.presentControlCenter()", native_case)
legacy_case = preparation_method.find("case .legacyRuntimeRestored:", native_case)
if not (
    0 <= status_start < preflight_call < preparation_task < prepare_runtime
    < native_case < webview_after_verify < legacy_case
):
    raise SystemExit(
        "native app must keep the WebView closed until app, runtime, and listener verification succeeds"
    )
if "await self.performLocalNetworkPrivacyPreflight()" in preparation_method:
    raise SystemExit(
        "local-network privacy preflight must run in parallel and never block runtime preparation"
    )

if "shouldRetryControlCenterNavigation(error)" not in source:
    raise SystemExit(
        "native WebView must ignore cancellation errors caused by its own fresh reload"
    )

if source.count("navigation === activeNavigation") < 3:
    raise SystemExit(
        "native WebView must ignore stale success and failure callbacks from replaced navigations"
    )

schedule_start = source.find("private func scheduleReload()")
schedule_end = source.find("\n    }\n}", schedule_start)
schedule_method = source[schedule_start:schedule_end]
if "Task<Never, Never>.isCancelled" not in schedule_method:
    raise SystemExit(
        "cancelled stale WebView retry tasks must stop before starting another load"
    )

reload_start = source.find("@objc private func reloadControlCenter()")
reload_end = source.find("private func configureMenu()", reload_start)
reload_method = source[reload_start:reload_end]
if (
    "scheduledReload?.cancel()" not in reload_method
    or "cachePolicy: .reloadIgnoringLocalCacheData" not in reload_method
):
    raise SystemExit(
        "post-migration reload must cancel stale retries and bypass cached legacy HTML"
    )

present_start = source.find("private func presentControlCenter()")
present_end = source.find("private func presentInstallationRequiredAlert()", present_start)
present_source = source[present_start:present_end]
if "guard !installationRequired, installationReady else" not in present_source:
    raise SystemExit(
        "native app must prevent every unverified launch from creating a WebView"
    )

create_window_start = source.find("private func createWindow()")
create_window_end = source.find("private func makeMainWindow()", create_window_start)
create_window_source = source[create_window_start:create_window_end]
if "loadControlCenter(cachePolicy: .reloadIgnoringLocalCacheData)" not in create_window_source:
    raise SystemExit(
        "native app must bypass stale Control Center HTML on the first verified WebView load"
    )

registration = source.find("guard await ensureBundledRuntimeServiceRegistered()")
stop_legacy = source.find("if !stopLegacyLaunchAgents(legacyStates)")
health_gate = source.find("var health = await waitForHealthyRuntime")
legacy_app_migration = source.find(
    "let migratedLegacyApps = await migrateLegacyAppsAfterHealthyRuntime",
    health_gate,
)
persist_version = source.find("recordCurrentRuntimeBundleVersion()", health_gate)
if not (
    0 <= stop_legacy < registration < health_gate
    < legacy_app_migration < persist_version
):
    raise SystemExit(
        "native app must stop legacy writers, register, pass local runtime health, migrate old apps, then persist"
    )
prepare_start = source.find("private func prepareCompanion() async")
prepare_end = source.find("private func ensureBundledRuntimeServiceRegistered()", prepare_start)
prepare_method = source[prepare_start:prepare_end]
if "/v1/device/repair" in prepare_method or "prepareExistingDeviceConnection" in prepare_method:
    raise SystemExit(
        "native installation must not probe, pair, or repair a VibeTV"
    )
native_ready = prepare_method.find("return .nativeRuntimeReady")
if not (0 <= prepare_method.find("var health = await waitForHealthyRuntime") < native_ready):
    raise SystemExit(
        "native runtime must pass the health and ownership gate before triggering a fresh WebView load"
    )
if "timeout: runtimeInitialHealthTimeout" not in prepare_method:
    raise SystemExit(
        "native runtime must detect a stale first Service Management launch before the full retry timeout"
    )
retry_gate = prepare_method.find("if shouldRetryRuntimeRegistration(")
retry_unregister = prepare_method.find("await unregisterBundledRuntimeService()", retry_gate)
retry_register = prepare_method.find("registerBundledRuntimeService()", retry_unregister)
retry_health = prepare_method.find("health = await waitForHealthyRuntime", retry_register)
final_health_gate = prepare_method.find("guard runtimeHealthGatePassed(health)", retry_health)
first_native_ready = prepare_method.find("return .nativeRuntimeReady", final_health_gate)
if not (
    prepare_method.count("if shouldRetryRuntimeRegistration(") == 1
    and 0 <= retry_gate < retry_unregister < retry_register < retry_health
    < final_health_gate < first_native_ready
):
    raise SystemExit(
        "native runtime may perform exactly one unregister/register/health recovery before the final gate"
    )
if "runtimeService.status == .enabled" in prepare_method[retry_health:first_native_ready]:
    raise SystemExit(
        "proven runtime health must not be rejected by a stale Service Management status"
    )

stop_method = source[
    source.find("private func stopLegacyLaunchAgents("):
    source.find("private func rollbackToLegacyAgents(")
]
disable_legacy = stop_method.find('launchctlExitStatus(["disable", service])')
bootout_legacy = stop_method.find('launchctlExitStatus(["bootout", service])')
if not (0 <= disable_legacy < bootout_legacy):
    raise SystemExit(
        "native app must disable legacy LaunchAgents before booting them out"
    )

rollback_method = source[
    source.find("private func rollbackToLegacyAgents("):
    source.find("private func restoreLegacyAgents(")
]
if (
    ") async -> Bool" not in rollback_method
    or "await unregisterBundledRuntimeService()" not in rollback_method
    or "return restoreLegacyAgents(states, reason: reason)" not in rollback_method
):
    raise SystemExit(
        "legacy rollback must stop the app-managed writer before restoring legacy services"
    )

restore_method = source[
    source.find("private func restoreLegacyAgents("):
    source.find("private func legacyServiceIsLoaded(")
]
if ") -> Bool" not in restore_method or "return restored" not in restore_method:
    raise SystemExit(
        "legacy restore must report whether the restored runtime is safe to reload"
    )
enable_legacy = restore_method.find('launchctlExitStatus(["enable", service])')
restart_legacy = restore_method.find('"bootstrap"')
if not (0 <= enable_legacy < restart_legacy):
    raise SystemExit(
        "legacy rollback must re-enable services before restoring their loaded state"
    )

migration_method = source[
    source.find("private func migrationArtifacts("):
    source.find("private func moveMigrationArtifacts(")
]
if "systemPlistURL" in migration_method or (
    "guard let userPlistURL = descriptor.migrationPlistURL" not in migration_method
):
    raise SystemExit(
        "migration backup must move only user LaunchAgent plists, never system plists"
    )

health_method = source[
    source.find("private func waitForHealthyRuntime("):
    source.find("private func currentCompanionVersion()")
]
if "timeout: TimeInterval = runtimeHealthTimeout" not in health_method:
    raise SystemExit(
        "native runtime recovery must retain the full health timeout after the fast first check"
    )
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

  python3 - "${ROOT}/scripts/sign-notarize-macos-control-center.sh" <<'PY'
import sys

source = open(sys.argv[1], encoding="utf-8").read()
positions = [
    source.index('"${sparkle_version_dir}/XPCServices/Downloader.xpc"'),
    source.index('"${sparkle_version_dir}/XPCServices/Installer.xpc"'),
    source.index('"${sparkle_version_dir}/Updater.app"'),
    source.index('"${sparkle_version_dir}/Autoupdate"'),
    source.index('"$sparkle_framework"', source.index('"${sparkle_version_dir}/Autoupdate"')),
    source.index('"$companion_binary"', source.index('"$sparkle_framework"')),
]
if positions != sorted(positions):
    raise SystemExit("Sparkle nested helpers, framework, and companion must be signed inside-out")
PY

  grep -qF 'VERSION="2.9.2"' "${ROOT}/scripts/fetch-sparkle.sh" \
    || die "Sparkle distribution version must stay pinned"
  grep -qF 'SHA256="1cb340cbbef04c6c0d162078610c25e2221031d794a3449d89f2f56f4df77c95"' "${ROOT}/scripts/fetch-sparkle.sh" \
    || die "Sparkle distribution checksum must stay pinned"
  grep -qF 'VERSION="0.44.0"' "${ROOT}/scripts/fetch-codexbar.sh" \
    || die "CodexBar distribution version must stay pinned"
  grep -qF 'SHA256="958c4b3fc64367d833b6e26df98d262b16384a52dcf6b8181f9b98091505671f"' "${ROOT}/scripts/fetch-codexbar.sh" \
    || die "CodexBar distribution checksum must stay pinned"
  grep -qF 'verify-bundled-codexbar.sh' "${ROOT}/.github/workflows/release.yml" \
    || die "release workflow must verify the bundled CodexBar payload"
  grep -qF 'generate_appcast' "${ROOT}/.github/workflows/release.yml" \
    || die "release workflow must generate a Sparkle appcast"
  grep -qF 'sparkle:edSignature=' "${ROOT}/.github/workflows/release.yml" \
    || die "release workflow must verify the appcast signature"
  grep -qF 'SPARKLE_ED25519_PRIVATE_KEY' "${ROOT}/.github/workflows/release.yml" \
    || die "release workflow must source the Sparkle private key from Actions secrets"

  grep -qF "com.codexbar-display.daemon" "${ROOT}/macos/VibeTVControlCenter/main.swift" \
    || die "native app shell must detect the old LaunchAgent"
  grep -qF "migration-backups" "${ROOT}/macos/VibeTVControlCenter/main.swift" \
    || die "native app shell must back up old LaunchAgents during migration"
  grep -qF "SMAppService.agent" "${ROOT}/macos/VibeTVControlCenter/main.swift" \
    || die "native app shell must manage its persistent runtime with SMAppService"
  grep -qF "NSWindowDelegate" "${ROOT}/macos/VibeTVControlCenter/main.swift" \
    || die "native app shell must observe window closure"
  grep -qF "func windowWillClose" "${ROOT}/macos/VibeTVControlCenter/main.swift" \
    || die "native app shell must tear down closed Control Center windows"
  grep -qF "func windowShouldClose" "${ROOT}/macos/VibeTVControlCenter/main.swift" \
    || die "native app shell must prepare browser state before closing"
  grep -qF "container.appearance = NSAppearance(named: .aqua)" "${ROOT}/macos/VibeTVControlCenter/main.swift" \
    || die "native installation status must keep AppKit controls visible in Dark Mode"
  grep -qF "vibetv:native-window-will-close" "${ROOT}/macos/VibeTVControlCenter/main.swift" \
    || die "native app shell must flush Theme Studio recovery before releasing the WebView"
  grep -qF "allowPreparedWindowClose" "${ROOT}/macos/VibeTVControlCenter/main.swift" \
    || die "native app shell must close only after browser-state preparation completes"
  grep -qF "webView = nil" "${ROOT}/macos/VibeTVControlCenter/main.swift" \
    || die "native app shell must release the WebView when its window closes"
  grep -qF "verify_companion_version" "${ROOT}/scripts/build-macos-control-center-app.sh" \
    || die "macOS app builds must reject a Companion with the wrong version"

  grep -qF "test-macos-control-center-app-bundle.sh" "${ROOT}/.github/workflows/ci.yml" \
    || die "CI must run the macOS app/DMG dry-run test"
  ! grep -Eq "brew (tap|publish|pr|create)|Homebrew/homebrew" "${ROOT}/.github/workflows/release.yml" \
    || die "release workflow must not publish Homebrew assets"
  grep -qF ".dmg" "${ROOT}/docs/operator-runbook.md" \
    || die "operator runbook must include DMG release readiness"

  test_signing_safety_helpers
  test_outer_dmg_ticket_policy_helper
  "${ROOT}/scripts/test-macos-control-center-runtime-validation.sh"

  printf 'macOS Control Center app bundle prep test passed\n'
}

main "$@"
