#!/usr/bin/env bash
set -euo pipefail

VERSION="0.46.0"
SHA256="8fe3e93b84151d682c7b80a10e2878c72cbf2e59ff78dd616c26e8cc197a79a0"
LICENSE_SHA256="14293556b79940745123d0160c71d27ed0e9fe9b8a848093f3ed78f4853caafe"
ARCHIVE_NAME="CodexBar-macos-universal-${VERSION}.zip"
APP_DIR=""

die() {
  printf 'error: %s\n' "$*" >&2
  exit 1
}

normalize_codexbar_signing_xattrs() {
  local app="$1"
  xattr -dr com.apple.FinderInfo "$app" 2>/dev/null || true
  xattr -dr com.apple.ResourceFork "$app" 2>/dev/null || true
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --app)
      [[ -n "${2:-}" ]] || die "--app needs a value"
      APP_DIR="$2"
      shift 2
      ;;
    -h|--help)
      printf 'Usage: verify-bundled-codexbar.sh --app path.app\n'
      exit 0
      ;;
    *)
      die "unknown argument: $1"
      ;;
  esac
done

[[ -d "$APP_DIR" ]] || die "app bundle not found: ${APP_DIR:-<missing>}"
resources="${APP_DIR}/Contents/Resources/CodexBar"
archive="${resources}/${ARCHIVE_NAME}"
manifest="${resources}/CodexBar-v${VERSION}.manifest.json"
license="${resources}/CodexBar-LICENSE.txt"

[[ -f "$archive" ]] || die "bundled CodexBar archive is missing"
[[ -s "$manifest" ]] || die "bundled CodexBar manifest is missing"
[[ -s "$license" ]] || die "bundled CodexBar license is missing"
actual="$(shasum -a 256 "$archive" | awk '{print $1}')"
[[ "$actual" == "$SHA256" ]] \
  || die "bundled CodexBar archive checksum mismatch: ${actual}"
license_actual="$(shasum -a 256 "$license" | awk '{print $1}')"
[[ "$license_actual" == "$LICENSE_SHA256" ]] \
  || die "bundled CodexBar license checksum mismatch: ${license_actual}"

python3 - "$manifest" "$VERSION" "$ARCHIVE_NAME" "$SHA256" "$LICENSE_SHA256" <<'PY'
import json
import sys

with open(sys.argv[1], encoding="utf-8") as handle:
    manifest = json.load(handle)

expected = {
    "name": "CodexBar",
    "version": sys.argv[2],
    "bundleIdentifier": "com.steipete.codexbar",
    "teamIdentifier": "Y5PE65HELJ",
    "archive": sys.argv[3],
    "sha256": sys.argv[4],
    "source": f"https://github.com/steipete/CodexBar/releases/tag/v{sys.argv[2]}",
    "license": "MIT",
    "licenseFile": "CodexBar-LICENSE.txt",
    "licenseSha256": sys.argv[5],
}
if manifest != expected:
    raise SystemExit("bundled CodexBar manifest does not match the pinned release")
PY

unzip -tq "$archive" >/dev/null \
  || die "bundled CodexBar archive is not a valid ZIP"
unzip -Z1 "$archive" | grep -Fx 'CodexBar.app/Contents/Info.plist' >/dev/null \
  || die "bundled CodexBar archive is missing its app Info.plist"
unzip -Z1 "$archive" | grep -Fx 'CodexBar.app/Contents/Helpers/CodexBarCLI' >/dev/null \
  || die "bundled CodexBar archive is missing CodexBarCLI"

for command in codesign ditto spctl xattr; do
  command -v "$command" >/dev/null 2>&1 || die "missing required verifier: $command"
done

tmp="$(mktemp -d "${TMPDIR:-/tmp}/vibetv-codexbar-verify.XXXXXX")"
trap 'rm -rf "$tmp"' EXIT
ditto -x -k "$archive" "$tmp/extracted"
staged_app="$tmp/extracted/CodexBar.app"
[[ -d "$staged_app" ]] || die "bundled CodexBar archive did not extract CodexBar.app"
finderinfo_path="$staged_app/Contents/PlugIns/CodexBarWidget.appex"
if ! xattr -p com.apple.FinderInfo "$finderinfo_path" >/dev/null 2>&1; then
  xattr -wx com.apple.FinderInfo \
    0000000000000000001000000000000000000000000000000000000000000000 \
    "$finderinfo_path"
fi
xattr -p com.apple.FinderInfo "$finderinfo_path" >/dev/null \
  || die "CodexBar FinderInfo regression fixture was not present before normalization"
normalize_codexbar_signing_xattrs "$staged_app"
if xattr -lr "$staged_app" 2>/dev/null | grep -E 'com\.apple\.(FinderInfo|ResourceFork):' >/dev/null; then
  die "staged CodexBar still contains disallowed signing xattrs after normalization"
fi
codesign --verify --deep --strict --verbose=2 "$staged_app"
signature_details="$(codesign --display --verbose=4 "$staged_app" 2>&1)"
[[ "$signature_details" == *"TeamIdentifier=Y5PE65HELJ"* ]] \
  || die "staged CodexBar TeamIdentifier does not match the pinned team"
spctl --assess --type execute --verbose=4 "$staged_app"

printf 'verified pinned CodexBar %s payload: %s\n' "$VERSION" "$archive"
