#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

APP_NAME="VibeTV Control Center"
APP_DIR="${ROOT}/dist/macos/${APP_NAME}.app"
DMG_PATH=""
DRY_RUN=0
SIGN_APP_ONLY=0
SKIP_APP_SIGN=0
KEYCHAIN_PATH=""
KEYCHAIN_PASSWORD=""
WORK_DIR=""
NOTARY_LOG_PATH=""
ORIGINAL_KEYCHAINS=()

REQUIRED_SECRETS=(
  APPLE_TEAM_ID
  APPLE_SIGNING_CERTIFICATE_P12_BASE64
  APPLE_SIGNING_CERTIFICATE_PASSWORD
  APPLE_NOTARY_KEY_ID
  APPLE_NOTARY_ISSUER_ID
  APPLE_NOTARY_KEY_P8_BASE64
)

usage() {
  cat <<'EOF'
Usage:
  sign-notarize-macos-control-center.sh [--app path.app] [--dmg file.dmg] [--dry-run]
  sign-notarize-macos-control-center.sh --app path.app --sign-app-only
  sign-notarize-macos-control-center.sh --app path.app --dmg file.dmg --skip-app-sign [--notary-log file.json]

Prepares the Developer ID signing and Apple notarization flow for the VibeTV
Control Center DMG. Real mode imports the Developer ID Application certificate
from CI secrets, signs with hardened runtime, submits the DMG to notarytool,
staples the ticket, and verifies the result.

Expected CI secrets:
  APPLE_TEAM_ID
  APPLE_SIGNING_CERTIFICATE_P12_BASE64
  APPLE_SIGNING_CERTIFICATE_PASSWORD
  APPLE_NOTARY_KEY_ID
  APPLE_NOTARY_ISSUER_ID
  APPLE_NOTARY_KEY_P8_BASE64

Optional:
  APPLE_SIGNING_IDENTITY
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

while [[ $# -gt 0 ]]; do
  case "$1" in
    --app)
      need_value "$1" "${2:-}"
      APP_DIR="$2"
      shift 2
      ;;
    --dmg)
      need_value "$1" "${2:-}"
      DMG_PATH="$2"
      shift 2
      ;;
    --dry-run)
      DRY_RUN=1
      shift
      ;;
    --sign-app-only)
      SIGN_APP_ONLY=1
      shift
      ;;
    --skip-app-sign)
      SKIP_APP_SIGN=1
      shift
      ;;
    --notary-log)
      need_value "$1" "${2:-}"
      NOTARY_LOG_PATH="$2"
      shift 2
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

if [[ "$SIGN_APP_ONLY" == "1" && "$SKIP_APP_SIGN" == "1" ]]; then
  die "--sign-app-only and --skip-app-sign cannot be combined"
fi
if [[ "$SIGN_APP_ONLY" == "1" && -n "$NOTARY_LOG_PATH" ]]; then
  die "--notary-log cannot be used with --sign-app-only"
fi

missing_secrets() {
  local name
  for name in "${REQUIRED_SECRETS[@]}"; do
    if [[ -z "${!name:-}" ]]; then
      printf '%s\n' "$name"
    fi
  done
}

decode_base64_to_file() {
  local value="$1"
  local target="$2"
  if base64 --help 2>&1 | grep -q -- '--decode'; then
    printf '%s' "$value" | base64 --decode > "$target"
  else
    printf '%s' "$value" | base64 -D > "$target"
  fi
}

cleanup() {
  if (( ${#ORIGINAL_KEYCHAINS[@]} > 0 )); then
    security list-keychains -d user -s "${ORIGINAL_KEYCHAINS[@]}" >/dev/null 2>&1 || true
  fi
  if [[ -n "$KEYCHAIN_PATH" ]]; then
    security delete-keychain "$KEYCHAIN_PATH" >/dev/null 2>&1 || true
  fi
  if [[ -n "$WORK_DIR" ]]; then
    rm -rf "$WORK_DIR"
  fi
}

require_real_inputs() {
  [[ -d "$APP_DIR" ]] || die "app bundle not found: ${APP_DIR}"
  [[ -f "${APP_DIR}/Contents/Info.plist" ]] || die "app bundle is missing Contents/Info.plist"
  if [[ "$SIGN_APP_ONLY" != "1" ]]; then
    [[ -n "$DMG_PATH" ]] || die "--dmg is required unless --sign-app-only is used"
    [[ -f "$DMG_PATH" ]] || die "DMG not found: ${DMG_PATH}"
  fi

  local missing
  missing="$(missing_secrets)"
  if [[ -n "$missing" ]]; then
    printf 'error: missing Apple signing/notary secrets:\n' >&2
    printf '%s\n' "$missing" | sed 's/^/  - /' >&2
    exit 1
  fi

  [[ "$(uname -s)" == "Darwin" ]] || die "real signing and notarization require macOS"
  command -v security >/dev/null 2>&1 || die "security is required"
  command -v codesign >/dev/null 2>&1 || die "codesign is required"
  command -v plutil >/dev/null 2>&1 || die "plutil is required"
  command -v xcrun >/dev/null 2>&1 || die "xcrun is required"
  command -v spctl >/dev/null 2>&1 || die "spctl is required"
}

dry_run() {
  printf 'dry-run: app=%s\n' "$APP_DIR"
  if [[ -n "$DMG_PATH" ]]; then
    printf 'dry-run: dmg=%s\n' "$DMG_PATH"
  else
    printf 'dry-run: dmg=<not set yet>\n'
  fi

  if [[ ! -d "$APP_DIR" ]]; then
    printf 'dry-run: app bundle is not present yet; structure check skipped\n'
  fi
  if [[ -n "$DMG_PATH" && ! -f "$DMG_PATH" ]]; then
    printf 'dry-run: DMG is not present yet; notarization upload skipped\n'
  fi

  local missing
  missing="$(missing_secrets)"
  if [[ -n "$missing" ]]; then
    printf 'dry-run: missing Apple signing/notary secrets:\n'
    printf '%s\n' "$missing" | sed 's/^/  - /'
  else
    printf 'dry-run: all Apple signing/notary secrets are present\n'
  fi

  cat <<EOF
dry-run: planned real-mode commands:
  curl https://www.apple.com/certificateauthority/DeveloperIDG2CA.cer
  security create-keychain / security import Developer ID Application certificate
  codesign --force --options runtime --timestamp --sign <identity> "${APP_DIR}/Contents/Resources/companion/codexbar-display"
  codesign --force --options runtime --timestamp --entitlements macos/VibeTVControlCenter/VibeTVControlCenter.entitlements --sign <identity> "${APP_DIR}"
  codesign --verify --deep --strict --verbose=2 "${APP_DIR}"
  syspolicy_check notary-submission "${APP_DIR}" (when available)
  build or rebuild the DMG from the already signed app bundle
  codesign --force --timestamp --sign <identity> "${DMG_PATH:-<dmg>}"
  codesign --verify --strict --verbose=2 "${DMG_PATH:-<dmg>}"
  xcrun notarytool submit "${DMG_PATH:-<dmg>}" --key <p8> --key-id APPLE_NOTARY_KEY_ID --issuer APPLE_NOTARY_ISSUER_ID --team-id APPLE_TEAM_ID --wait --output-format json
  require notarytool status Accepted and retrieve the notarization log
  xcrun stapler staple "${DMG_PATH:-<dmg>}"
  xcrun stapler validate "${DMG_PATH:-<dmg>}"
  spctl --assess --type open --context context:primary-signature --verbose "${DMG_PATH:-<dmg>}"
EOF
}

find_signing_identity() {
  if [[ -n "${APPLE_SIGNING_IDENTITY:-}" ]]; then
    printf '%s\n' "$APPLE_SIGNING_IDENTITY"
    return 0
  fi

  security find-identity -v -p codesigning "$KEYCHAIN_PATH" \
    | awk -F '"' '/Developer ID Application/ { print $2; exit }'
}

import_developer_id_intermediate() {
  local target="$1"
  local url="https://www.apple.com/certificateauthority/DeveloperIDG2CA.cer"

  command -v curl >/dev/null 2>&1 || die "curl is required to download Apple Developer ID intermediate certificates"
  curl -fsSL "$url" -o "$target" \
    || die "could not download Apple Developer ID G2 intermediate certificate"
  security import "$target" \
    -k "$KEYCHAIN_PATH" \
    -T /usr/bin/codesign \
    -T /usr/bin/security >/dev/null
}

sign_app_bundle() {
  local identity="$1"
  local companion_binary="${APP_DIR}/Contents/Resources/companion/codexbar-display"
  local authority signature_details signed_team_id

  if [[ -x "$companion_binary" ]]; then
    codesign \
      --force \
      --options runtime \
      --timestamp \
      --sign "$identity" \
      "$companion_binary"
    codesign --verify --strict --verbose=2 "$companion_binary"
  fi

  codesign \
    --force \
    --options runtime \
    --timestamp \
    --entitlements "${ROOT}/macos/VibeTVControlCenter/VibeTVControlCenter.entitlements" \
    --sign "$identity" \
    "$APP_DIR"
  codesign --verify --deep --strict --verbose=2 "$APP_DIR"

  signature_details="$(codesign --display --verbose=4 "$APP_DIR" 2>&1)"
  authority="$(printf '%s\n' "$signature_details" | sed -n 's/^Authority=//p' | head -n1)"
  signed_team_id="$(printf '%s\n' "$signature_details" | sed -n 's/^TeamIdentifier=//p' | head -n1)"
  [[ "$authority" == "Developer ID Application:"* ]] \
    || die "app is not signed with a Developer ID Application certificate"
  [[ "$signed_team_id" == "$APPLE_TEAM_ID" ]] \
    || die "signed app TeamIdentifier ${signed_team_id:-<missing>} does not match APPLE_TEAM_ID"
  [[ "$signature_details" == *"(runtime)"* ]] \
    || die "signed app does not have hardened runtime enabled"

  if command -v syspolicy_check >/dev/null 2>&1; then
    syspolicy_check notary-submission "$APP_DIR"
  fi
}

notary_log() {
  local submission_id="$1"
  local p8_path="$2"
  local output_path="$3"

  xcrun notarytool log "$submission_id" "$output_path" \
    --key "$p8_path" \
    --key-id "$APPLE_NOTARY_KEY_ID" \
    --issuer "$APPLE_NOTARY_ISSUER_ID" \
    --team-id "$APPLE_TEAM_ID"
}

real_run() {
  require_real_inputs
  trap cleanup EXIT

  local cert_path p8_path developer_id_g2_path identity keychain
  local notary_result_path notary_status submission_id submit_exit
  WORK_DIR="$(mktemp -d "${TMPDIR:-/tmp}/vibetv-sign.XXXXXX")"
  cert_path="${WORK_DIR}/developer-id.p12"
  p8_path="${WORK_DIR}/notary-key.p8"
  developer_id_g2_path="${WORK_DIR}/DeveloperIDG2CA.cer"
  notary_result_path="${WORK_DIR}/notary-result.json"
  KEYCHAIN_PATH="${WORK_DIR}/vibetv-signing.keychain-db"
  KEYCHAIN_PASSWORD="$(uuidgen)"

  if [[ -z "$NOTARY_LOG_PATH" ]]; then
    NOTARY_LOG_PATH="${WORK_DIR}/notarization-log.json"
  else
    mkdir -p "$(dirname "$NOTARY_LOG_PATH")"
  fi

  decode_base64_to_file "$APPLE_SIGNING_CERTIFICATE_P12_BASE64" "$cert_path"
  decode_base64_to_file "$APPLE_NOTARY_KEY_P8_BASE64" "$p8_path"
  chmod 600 "$cert_path" "$p8_path"

  security create-keychain -p "$KEYCHAIN_PASSWORD" "$KEYCHAIN_PATH"
  security set-keychain-settings -lut 21600 "$KEYCHAIN_PATH"
  security unlock-keychain -p "$KEYCHAIN_PASSWORD" "$KEYCHAIN_PATH"
  while IFS= read -r keychain; do
    keychain="$(printf '%s' "$keychain" | sed 's/^[[:space:]]*"//; s/"[[:space:]]*$//')"
    [[ -n "$keychain" ]] && ORIGINAL_KEYCHAINS+=("$keychain")
  done < <(security list-keychains -d user)
  security list-keychains -d user -s "$KEYCHAIN_PATH" "${ORIGINAL_KEYCHAINS[@]}"
  import_developer_id_intermediate "$developer_id_g2_path"
  security import "$cert_path" \
    -k "$KEYCHAIN_PATH" \
    -P "$APPLE_SIGNING_CERTIFICATE_PASSWORD" \
    -T /usr/bin/codesign \
    -T /usr/bin/security
  security set-key-partition-list -S apple-tool:,apple: -s -k "$KEYCHAIN_PASSWORD" "$KEYCHAIN_PATH"

  identity="$(find_signing_identity)"
  [[ -n "$identity" ]] || die "could not find a Developer ID Application signing identity"

  if [[ "$SKIP_APP_SIGN" != "1" ]]; then
    sign_app_bundle "$identity"
  fi

  if [[ "$SIGN_APP_ONLY" == "1" ]]; then
    printf 'signed and verified app bundle: %s\n' "$APP_DIR"
    return 0
  fi

  codesign --force --timestamp --sign "$identity" "$DMG_PATH"
  codesign --verify --strict --verbose=2 "$DMG_PATH"

  submit_exit=0
  xcrun notarytool submit "$DMG_PATH" \
    --key "$p8_path" \
    --key-id "$APPLE_NOTARY_KEY_ID" \
    --issuer "$APPLE_NOTARY_ISSUER_ID" \
    --team-id "$APPLE_TEAM_ID" \
    --wait \
    --no-progress \
    --output-format json > "$notary_result_path" || submit_exit=$?

  submission_id="$(plutil -extract id raw -o - "$notary_result_path" 2>/dev/null || true)"
  notary_status="$(plutil -extract status raw -o - "$notary_result_path" 2>/dev/null || true)"

  if [[ -n "$submission_id" ]]; then
    notary_log "$submission_id" "$p8_path" "$NOTARY_LOG_PATH" || {
      printf 'error: could not retrieve notarization log for submission %s\n' "$submission_id" >&2
      exit 1
    }
  fi

  if [[ "$submit_exit" != "0" || "$notary_status" != "Accepted" ]]; then
    printf 'error: Apple notarization did not finish as Accepted (status=%s, exit=%s, id=%s)\n' \
      "${notary_status:-<missing>}" "$submit_exit" "${submission_id:-<missing>}" >&2
    sed 's/^/  /' "$notary_result_path" >&2 || true
    if [[ -f "$NOTARY_LOG_PATH" ]]; then
      sed 's/^/  /' "$NOTARY_LOG_PATH" >&2 || true
    fi
    exit 1
  fi

  [[ -f "$NOTARY_LOG_PATH" ]] || die "notarization log was not created"
  [[ "$(plutil -extract status raw -o - "$NOTARY_LOG_PATH" 2>/dev/null || true)" == "Accepted" ]] \
    || die "notarization log does not report Accepted"

  printf 'Apple notarization accepted: %s\n' "$submission_id"
  xcrun stapler staple "$DMG_PATH"
  xcrun stapler validate "$DMG_PATH"

  codesign --verify --strict --verbose=2 "$DMG_PATH"
  spctl --assess --type open --context context:primary-signature --verbose "$DMG_PATH"
  printf 'signed, notarized, stapled, and verified: %s\n' "$DMG_PATH"
}

if [[ "$DRY_RUN" == "1" ]]; then
  dry_run
else
  real_run
fi
