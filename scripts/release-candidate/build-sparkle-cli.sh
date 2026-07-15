#!/usr/bin/env bash
set -euo pipefail

SPARKLE_VERSION="2.9.4"
SPARKLE_SOURCE_SHA256="f22982ba6e1a951be4b60bdd0733e74e99b28eed6c3013edd99765af87c79d49"
SPARKLE_SOURCE_URL="https://github.com/sparkle-project/Sparkle/archive/refs/tags/${SPARKLE_VERSION}.tar.gz"
OUTPUT=""

usage() {
  cat <<'EOF'
Usage:
  build-sparkle-cli.sh --output path/to/sparkle-cli.tar.gz

Builds Sparkle's official external updater from pinned source, applies an
ad-hoc signature for the disposable VM test environment, and archives the
complete sparkle.app bundle with framework symlinks preserved.
EOF
}

die() {
  printf 'error: %s\n' "$*" >&2
  exit 1
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --output) [[ -n "${2:-}" ]] || die "--output needs a value"; OUTPUT="$2"; shift 2 ;;
    -h|--help) usage; exit 0 ;;
    *) die "unknown argument: $1" ;;
  esac
done

[[ -n "$OUTPUT" && "$OUTPUT" != "/" ]] || die "safe --output path is required"
[[ "$(uname -s)" == "Darwin" ]] || die "Sparkle CLI must be built on macOS"
for command in codesign curl shasum tar xcodebuild; do
  command -v "$command" >/dev/null 2>&1 || die "required command is missing: $command"
done

WORK="$(mktemp -d "${TMPDIR:-/tmp}/vibetv-sparkle-cli.XXXXXX")"
cleanup() {
  rm -rf "$WORK"
}
trap cleanup EXIT HUP INT TERM

archive="$WORK/Sparkle-source.tar.gz"
curl -fsSL "$SPARKLE_SOURCE_URL" -o "$archive"
[[ "$(shasum -a 256 "$archive" | awk '{print $1}')" == "$SPARKLE_SOURCE_SHA256" ]] \
  || die "Sparkle source checksum mismatch"
tar -xzf "$archive" -C "$WORK"

source="$WORK/Sparkle-${SPARKLE_VERSION}"
derived="$WORK/DerivedData"
xcodebuild \
  -project "$source/Sparkle.xcodeproj" \
  -scheme sparkle-cli \
  -configuration Release \
  -derivedDataPath "$derived" \
  CODE_SIGNING_ALLOWED=NO \
  build

app="$derived/Build/Products/Release/sparkle.app"
[[ -d "$app" ]] || die "Sparkle CLI build did not produce sparkle.app"
framework="$app/Contents/Frameworks/Sparkle.framework"
[[ -d "$framework" ]] || die "Sparkle CLI is missing Sparkle.framework"

sign_component() {
  local path="$1"
  shift
  if [[ -e "$path" ]]; then
    codesign --force --options runtime "$@" --sign - "$path"
  fi
}

# Sparkle documents this inside-out signing order for manually embedded
# frameworks. The CLI is used only inside disposable VMs and is ad-hoc signed.
sign_component "$framework/Versions/B/XPCServices/Installer.xpc"
sign_component "$framework/Versions/B/XPCServices/Downloader.xpc" --preserve-metadata=entitlements
sign_component "$framework/Versions/B/Autoupdate"
sign_component "$framework/Versions/B/Updater.app"
sign_component "$framework"
sign_component "$app"
codesign --verify --deep --strict --verbose=2 "$app"

mkdir -p "$(dirname "$OUTPUT")"
rm -f "$OUTPUT"
COPYFILE_DISABLE=1 tar -czf "$OUTPUT" -C "$(dirname "$app")" "$(basename "$app")"
[[ -s "$OUTPUT" ]] || die "Sparkle CLI archive was not created"
printf 'Built pinned Sparkle CLI archive: %s\n' "$OUTPUT"
