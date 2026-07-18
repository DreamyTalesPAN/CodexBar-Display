#!/usr/bin/env bash
set -euo pipefail

VERSION="0.44.0"
SHA256="958c4b3fc64367d833b6e26df98d262b16384a52dcf6b8181f9b98091505671f"
LICENSE_SHA256="14293556b79940745123d0160c71d27ed0e9fe9b8a848093f3ed78f4853caafe"
ARCHIVE_NAME="CodexBar-macos-universal-${VERSION}.zip"
APP_DIR=""

die() {
  printf 'error: %s\n' "$*" >&2
  exit 1
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

printf 'verified pinned CodexBar %s payload: %s\n' "$VERSION" "$archive"
