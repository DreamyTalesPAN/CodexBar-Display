#!/usr/bin/env bash
set -euo pipefail

APP_NAME="VibeTV Control Center"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DMG_PATH=""
DRY_RUN=0
MOUNT_DIR=""
POLICY_WORK_DIR=""

usage() {
  cat <<'EOF'
Usage:
  verify-macos-control-center-dmg.sh --dmg file.dmg [--dry-run]

Verifies the final signed, notarized, and stapled customer DMG. Real mode
checks the DMG container and signature, validates the stapled ticket, mounts
the exact artifact, and runs signature and Gatekeeper checks on the app copy
inside it.
EOF
}

die() {
  printf 'error: %s\n' "$*" >&2
  exit 1
}

need_value() {
  local name="$1"
  local value="${2:-}"
  [[ -n "$value" ]] || die "${name} needs a value"
}

cleanup() {
  if [[ -n "$MOUNT_DIR" && -d "$MOUNT_DIR" ]]; then
    hdiutil detach "$MOUNT_DIR" -quiet >/dev/null 2>&1 || true
    rmdir "$MOUNT_DIR" >/dev/null 2>&1 || true
  fi
  if [[ -n "$POLICY_WORK_DIR" ]]; then
    rm -rf "$POLICY_WORK_DIR"
  fi
}

is_exact_outer_dmg_app_ticket_report() {
  local report_path="$1"
  local app_path="$2"

  [[ -s "$report_path" ]] || return 1
  command -v python3 >/dev/null 2>&1 || return 1

  python3 - "$report_path" "$app_path" <<'PY'
import json
import os
import sys


def unique_object(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValueError(f"duplicate JSON key: {key}")
        result[key] = value
    return result


try:
    with open(sys.argv[1], encoding="utf-8") as report_file:
        report = json.load(report_file, object_pairs_hook=unique_object)
except (OSError, UnicodeError, ValueError, json.JSONDecodeError):
    raise SystemExit(1)

if not isinstance(report, dict) or set(report) != {"output"}:
    raise SystemExit(1)
output = report["output"]
if not isinstance(output, list) or len(output) != 1:
    raise SystemExit(1)
diagnostic = output[0]
expected_keys = {
    "SyspolicyCheckAdditionalInformation",
    "SyspolicyCheckAdvice",
    "SyspolicyCheckDocumentationLink",
    "SyspolicyCheckErrorFile",
    "SyspolicyCheckErrorLevel",
    "SyspolicyCheckLongError",
    "SyspolicyCheckShortError",
}
if not isinstance(diagnostic, dict) or set(diagnostic) != expected_keys:
    raise SystemExit(1)
if not all(isinstance(diagnostic[key], str) for key in expected_keys):
    raise SystemExit(1)

expected_advice = (
    "If this application has already been uploaded to the Apple notary service, "
    "please make sure to attach the ticket with the `stapler staple` command. "
    "If not, please upload to the Apple notary service using Xcode or via "
    "`notarytool`."
)
expected_documentation = (
    "https://developer.apple.com/documentation/security/"
    "notarizing_macos_software_before_distribution"
)
if diagnostic["SyspolicyCheckAdditionalInformation"] != "":
    raise SystemExit(1)
if diagnostic["SyspolicyCheckAdvice"].strip() != expected_advice:
    raise SystemExit(1)
if diagnostic["SyspolicyCheckDocumentationLink"].strip().rstrip(".") != expected_documentation:
    raise SystemExit(1)
if diagnostic["SyspolicyCheckErrorLevel"] != "Fatal":
    raise SystemExit(1)
if diagnostic["SyspolicyCheckLongError"] != (
    "A Notarization ticket is not stapled to this application."
):
    raise SystemExit(1)
if diagnostic["SyspolicyCheckShortError"] != "Notary Ticket Missing":
    raise SystemExit(1)

reported_file = diagnostic["SyspolicyCheckErrorFile"]
expected_app = os.path.realpath(sys.argv[2])
expected_basename = os.path.basename(expected_app)
if os.path.isabs(reported_file):
    try:
        if not os.path.samefile(reported_file, expected_app):
            raise SystemExit(1)
    except OSError:
        raise SystemExit(1)
elif reported_file != expected_basename:
    raise SystemExit(1)
PY
}

run_mounted_app_distribution_policy_check() {
  local report_path stderr_path policy_exit=0

  POLICY_WORK_DIR="$(mktemp -d "${TMPDIR:-/tmp}/vibetv-policy-check.XXXXXX")" || {
    printf '%s\n' 'error: could not create syspolicy_check work directory' >&2
    return 1
  }
  report_path="${POLICY_WORK_DIR}/syspolicy-distribution.json"
  stderr_path="${POLICY_WORK_DIR}/syspolicy-distribution.stderr"

  syspolicy_check distribution "$MOUNTED_APP" --json \
    > "$report_path" 2> "$stderr_path" || policy_exit=$?

  if [[ "$policy_exit" == "0" ]]; then
    [[ ! -s "$stderr_path" ]] || cat "$stderr_path" >&2
    rm -rf "$POLICY_WORK_DIR"
    POLICY_WORK_DIR=""
    return 0
  fi

  if [[ "$policy_exit" == "70" && ! -s "$stderr_path" ]] &&
      is_exact_outer_dmg_app_ticket_report "$report_path" "$MOUNTED_APP"; then
    cat "$report_path" >&2
    printf '%s\n' \
      'warning: the app has no separately stapled ticket; the already validated outer DMG carries the notarization ticket.' >&2
    rm -rf "$POLICY_WORK_DIR"
    POLICY_WORK_DIR=""
    return 0
  fi

  [[ ! -s "$report_path" ]] || cat "$report_path" >&2
  [[ ! -s "$stderr_path" ]] || cat "$stderr_path" >&2
  printf 'error: syspolicy_check distribution failed (exit=%s)\n' \
    "$policy_exit" >&2
  rm -rf "$POLICY_WORK_DIR"
  POLICY_WORK_DIR=""
  return "$policy_exit"
}

verify_mounted_app_gatekeeper() {
  local assessment_output

  if command -v syspolicy_check >/dev/null 2>&1; then
    run_mounted_app_distribution_policy_check || return $?
  fi

  assessment_output="$(
    spctl --assess --type execute --verbose=4 "$MOUNTED_APP" 2>&1
  )" || {
    printf '%s\n' "$assessment_output" >&2
    return 1
  }
  printf '%s\n' "$assessment_output"
  if [[ "$assessment_output" != *": accepted"* ]]; then
    printf '%s\n' 'error: Gatekeeper did not accept the mounted app' >&2
    return 1
  fi
  if [[ "$assessment_output" != *"source=Notarized Developer ID"* ]]; then
    printf '%s\n' \
      'error: mounted app Gatekeeper source is not Notarized Developer ID' >&2
    return 1
  fi
}

if [[ "${BASH_SOURCE[0]}" != "$0" ]]; then
  return 0
fi

while [[ $# -gt 0 ]]; do
  case "$1" in
    --dmg)
      need_value "$1" "${2:-}"
      DMG_PATH="$2"
      shift 2
      ;;
    --dry-run)
      DRY_RUN=1
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      die "unknown argument: $1"
      ;;
  esac
done

[[ -n "$DMG_PATH" ]] || die "--dmg is required"

if [[ "$DRY_RUN" == "1" ]]; then
  cat <<EOF
dry-run: planned distribution verification for ${DMG_PATH}:
  hdiutil verify "${DMG_PATH}"
  codesign --verify --strict --verbose=2 "${DMG_PATH}"
  xcrun stapler validate "${DMG_PATH}"
  spctl --assess --type open --context context:primary-signature --verbose=4 "${DMG_PATH}"
  hdiutil attach -readonly -nobrowse -noautoopen "${DMG_PATH}"
  codesign --verify --deep --strict --verbose=2 "<mount>/${APP_NAME}.app"
  verify the pinned CodexBar ZIP, manifest, and MIT license resource
  syspolicy_check distribution "<mount>/${APP_NAME}.app" (allow only the exact outer-DMG ticket diagnostic)
  spctl --assess --type execute --verbose=4 "<mount>/${APP_NAME}.app"
EOF
  exit 0
fi

[[ "$(uname -s)" == "Darwin" ]] || die "DMG distribution verification requires macOS"
[[ -f "$DMG_PATH" ]] || die "DMG not found: ${DMG_PATH}"
for command in codesign hdiutil spctl xcrun; do
  command -v "$command" >/dev/null 2>&1 || die "${command} is required"
done

trap cleanup EXIT

hdiutil verify "$DMG_PATH"
codesign --verify --strict --verbose=2 "$DMG_PATH"
xcrun stapler validate "$DMG_PATH"
spctl \
  --assess \
  --type open \
  --context context:primary-signature \
  --verbose=4 \
  "$DMG_PATH"

MOUNT_DIR="$(mktemp -d "${TMPDIR:-/tmp}/vibetv-dmg-verify.XXXXXX")"
hdiutil attach \
  -readonly \
  -nobrowse \
  -noautoopen \
  -mountpoint "$MOUNT_DIR" \
  "$DMG_PATH" >/dev/null

MOUNTED_APP="${MOUNT_DIR}/${APP_NAME}.app"
[[ -d "$MOUNTED_APP" ]] || die "DMG is missing ${APP_NAME}.app"
[[ -L "${MOUNT_DIR}/Applications" ]] || die "DMG is missing the Applications symlink"
[[ "$(readlink "${MOUNT_DIR}/Applications")" == "/Applications" ]] \
  || die "DMG Applications symlink does not point to /Applications"

codesign --verify --deep --strict --verbose=2 "$MOUNTED_APP"
"${ROOT}/scripts/verify-bundled-codexbar.sh" --app "$MOUNTED_APP"
verify_mounted_app_gatekeeper

printf 'post-notarization distribution checks passed for DMG: %s\n' "$DMG_PATH"
