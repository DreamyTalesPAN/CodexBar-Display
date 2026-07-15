#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

APP_NAME="VibeTV Control Center"
BUNDLE_ID="shop.vibetv.control-center"
EXECUTABLE_NAME="VibeTVControlCenter"
COMPANION_NAME="codexbar-display"
ICON_FILE_NAME="VibeTVControlCenter.icns"
RUNTIME_AGENT_PLIST_NAME="shop.vibetv.control-center.runtime.plist"
APP_ICON="${ROOT}/macos/VibeTVControlCenter/${ICON_FILE_NAME}"
RUNTIME_AGENT_PLIST="${ROOT}/macos/VibeTVControlCenter/${RUNTIME_AGENT_PLIST_NAME}"
SPARKLE_PUBLIC_KEY_FILE="${ROOT}/macos/VibeTVControlCenter/SparklePublicKey.txt"
SPARKLE_FEED_URL="${SPARKLE_FEED_URL:-https://github.com/DreamyTalesPAN/CodexBar-Display/releases/latest/download/appcast.xml}"
SPARKLE_PUBLIC_ED_KEY="${SPARKLE_PUBLIC_ED_KEY:-}"
SPARKLE_DIST_DIR=""
VERSION="${VERSION:-0.0.0}"
BUILD="${BUILD:-0}"
APP_DIR="${ROOT}/dist/macos/${APP_NAME}.app"
CONTROL_CENTER_STATIC="${ROOT}/apps/control-center/out-local"
COMPANION_BINARY=""
DRY_RUN=0
UNIVERSAL=0

usage() {
  cat <<EOF
Usage:
  build-macos-control-center-app.sh [--version x.y.z] [--build n] [--output path.app] [--control-center-static dir] [--companion-binary path] [--app-icon path.icns] [--sparkle-feed-url url] [--sparkle-public-key key] [--universal] [--dry-run]

Builds the prepared macOS .app bundle for ${APP_NAME}.

Dry-run mode creates the bundle structure without requiring Swift, Apple
certificates, or a real Companion binary. Real mode requires macOS, swiftc,
a static Control Center export, and --companion-binary.
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
    --version)
      need_value "$1" "${2:-}"
      VERSION="${2#v}"
      shift 2
      ;;
    --build)
      need_value "$1" "${2:-}"
      BUILD="$2"
      shift 2
      ;;
    --output)
      need_value "$1" "${2:-}"
      APP_DIR="$2"
      shift 2
      ;;
    --control-center-static)
      need_value "$1" "${2:-}"
      CONTROL_CENTER_STATIC="$2"
      shift 2
      ;;
    --companion-binary)
      need_value "$1" "${2:-}"
      COMPANION_BINARY="$2"
      shift 2
      ;;
    --app-icon)
      need_value "$1" "${2:-}"
      APP_ICON="$2"
      shift 2
      ;;
    --sparkle-feed-url)
      need_value "$1" "${2:-}"
      SPARKLE_FEED_URL="$2"
      shift 2
      ;;
    --sparkle-public-key)
      need_value "$1" "${2:-}"
      SPARKLE_PUBLIC_ED_KEY="$2"
      shift 2
      ;;
    --dry-run)
      DRY_RUN=1
      shift
      ;;
    --universal)
      UNIVERSAL=1
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

if [[ -z "$SPARKLE_PUBLIC_ED_KEY" && -f "$SPARKLE_PUBLIC_KEY_FILE" ]]; then
  SPARKLE_PUBLIC_ED_KEY="$(tr -d '[:space:]' < "$SPARKLE_PUBLIC_KEY_FILE")"
fi
[[ "$SPARKLE_FEED_URL" == https://* ]] || die "Sparkle feed URL must use HTTPS"
[[ "$SPARKLE_PUBLIC_ED_KEY" =~ ^[A-Za-z0-9+/]{43}=$ ]] \
  || die "Sparkle public key must be one base64-encoded Ed25519 key"

xml_escape() {
  local value="$1"
  value="${value//&/&amp;}"
  value="${value//</&lt;}"
  value="${value//>/&gt;}"
  value="${value//\"/&quot;}"
  printf '%s' "$value"
}

require_app_output_path() {
  [[ -n "$APP_DIR" ]] || die "app output path cannot be empty"
  [[ "$APP_DIR" == *.app ]] || die "app output path must end in .app: ${APP_DIR}"
  [[ "$APP_DIR" != "/" ]] || die "refusing to use / as app output path"
}

write_info_plist() {
  local plist="$1"
  cat > "$plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
  <dict>
    <key>CFBundleDevelopmentRegion</key>
    <string>en</string>
    <key>CFBundleDisplayName</key>
    <string>$(xml_escape "$APP_NAME")</string>
    <key>CFBundleExecutable</key>
    <string>$(xml_escape "$EXECUTABLE_NAME")</string>
    <key>CFBundleIconFile</key>
    <string>$(xml_escape "$ICON_FILE_NAME")</string>
    <key>CFBundleIdentifier</key>
    <string>$(xml_escape "$BUNDLE_ID")</string>
    <key>CFBundleName</key>
    <string>$(xml_escape "$APP_NAME")</string>
    <key>CFBundlePackageType</key>
    <string>APPL</string>
    <key>CFBundleShortVersionString</key>
    <string>$(xml_escape "${VERSION#v}")</string>
    <key>CFBundleURLTypes</key>
    <array>
      <dict>
        <key>CFBundleTypeRole</key>
        <string>Editor</string>
        <key>CFBundleURLName</key>
        <string>$(xml_escape "$BUNDLE_ID")</string>
        <key>CFBundleURLSchemes</key>
        <array>
          <string>vibetv</string>
        </array>
      </dict>
    </array>
    <key>CFBundleVersion</key>
    <string>$(xml_escape "$BUILD")</string>
    <key>LSApplicationCategoryType</key>
    <string>public.app-category.utilities</string>
    <key>LSMinimumSystemVersion</key>
    <string>13.0</string>
    <key>NSAppTransportSecurity</key>
    <dict>
      <key>NSAllowsLocalNetworking</key>
      <true/>
    </dict>
    <key>NSLocalNetworkUsageDescription</key>
    <string>VibeTV Control Center uses the local network to connect to your VibeTV display.</string>
    <key>NSPrincipalClass</key>
    <string>NSApplication</string>
    <key>SUEnableAutomaticChecks</key>
    <false/>
    <key>SUFeedURL</key>
    <string>$(xml_escape "$SPARKLE_FEED_URL")</string>
    <key>SUPublicEDKey</key>
    <string>$(xml_escape "$SPARKLE_PUBLIC_ED_KEY")</string>
  </dict>
</plist>
PLIST
}

copy_control_center_static() {
  local target="$1"
  mkdir -p "$target"
  if [[ -d "$CONTROL_CENTER_STATIC" ]] && find "$CONTROL_CENTER_STATIC" -mindepth 1 -maxdepth 1 | grep -q .; then
    cp -R "${CONTROL_CENTER_STATIC}/." "$target/"
    return 0
  fi

  if [[ "$DRY_RUN" == "1" ]]; then
    cat > "${target}/README.md" <<EOF
# Control Center static export placeholder

Real DMG builds copy apps/control-center/out-local here after running:

  cd apps/control-center
  npm ci
  npm run build:local
EOF
    return 0
  fi

  die "missing Control Center static export at ${CONTROL_CENTER_STATIC}; run npm ci and npm run build:local in apps/control-center first"
}

copy_companion_binary() {
  local target_dir="$1"
  mkdir -p "$target_dir"

  if [[ -n "$COMPANION_BINARY" ]]; then
    [[ -f "$COMPANION_BINARY" ]] || die "companion binary not found: ${COMPANION_BINARY}"
    cp "$COMPANION_BINARY" "${target_dir}/${COMPANION_NAME}"
    chmod 755 "${target_dir}/${COMPANION_NAME}"
    return 0
  fi

  if [[ "$DRY_RUN" == "1" ]]; then
    cat > "${target_dir}/${COMPANION_NAME}" <<'EOF'
#!/usr/bin/env bash
printf 'VibeTV Control Center dry-run companion\n'
EOF
    chmod 755 "${target_dir}/${COMPANION_NAME}"
    return 0
  fi

  die "real app builds need --companion-binary path/to/${COMPANION_NAME}"
}

copy_runtime_agent_plist() {
  local target="$1"
  [[ -f "$RUNTIME_AGENT_PLIST" ]] || die "runtime LaunchAgent plist not found: ${RUNTIME_AGENT_PLIST}"
  sed \
    -e "s/__VIBETV_MAC_APP_VERSION__/$(xml_escape "${VERSION#v}")/g" \
    -e "s/__VIBETV_MAC_APP_BUILD__/$(xml_escape "$BUILD")/g" \
    "$RUNTIME_AGENT_PLIST" > "$target"
}

prepare_sparkle() {
  if [[ "$DRY_RUN" == "1" ]]; then
    return 0
  fi
  SPARKLE_DIST_DIR="$("${ROOT}/scripts/fetch-sparkle.sh")"
  [[ -d "${SPARKLE_DIST_DIR}/Sparkle.framework" ]] \
    || die "Sparkle framework not found after verified download"
}

copy_sparkle_framework() {
  local target_dir="$1"
  mkdir -p "$target_dir"
  if [[ "$DRY_RUN" == "1" ]]; then
    mkdir -p "${target_dir}/Sparkle.framework"
    printf 'Sparkle 2.9.2 dry-run placeholder\n' > "${target_dir}/Sparkle.framework/README.txt"
    return 0
  fi
  command -v ditto >/dev/null 2>&1 || die "ditto is required to preserve Sparkle framework symlinks"
  ditto "${SPARKLE_DIST_DIR}/Sparkle.framework" "${target_dir}/Sparkle.framework"
}

copy_app_icon() {
  local target_dir="$1"
  [[ -f "$APP_ICON" ]] || die "app icon not found: ${APP_ICON}"
  cp "$APP_ICON" "${target_dir}/${ICON_FILE_NAME}"
}

build_executable() {
  local target="$1"

  if [[ "$DRY_RUN" == "1" ]]; then
    cat > "$target" <<'EOF'
#!/usr/bin/env bash
printf 'VibeTV Control Center dry-run app shell\n'
EOF
    chmod 755 "$target"
    return 0
  fi

  [[ "$(uname -s)" == "Darwin" ]] || die "real Swift app builds require macOS"
  command -v swiftc >/dev/null 2>&1 || die "swiftc is required to build the native WebView shell"

  if [[ "$UNIVERSAL" == "1" ]]; then
    command -v lipo >/dev/null 2>&1 || die "lipo is required for universal app builds"

    local build_dir x86_binary arm64_binary
    build_dir="$(mktemp -d "${TMPDIR:-/tmp}/vibetv-swift-universal.XXXXXX")"
    x86_binary="${build_dir}/${EXECUTABLE_NAME}-x86_64"
    arm64_binary="${build_dir}/${EXECUTABLE_NAME}-arm64"

    swiftc \
      -target x86_64-apple-macos13 \
      "${ROOT}/macos/VibeTVControlCenter/main.swift" \
      -o "$x86_binary" \
      -F "$SPARKLE_DIST_DIR" \
      -framework Cocoa \
      -framework ServiceManagement \
      -framework Sparkle \
      -Xlinker -rpath \
      -Xlinker @executable_path/../Frameworks \
      -framework WebKit
    swiftc \
      -target arm64-apple-macos13 \
      "${ROOT}/macos/VibeTVControlCenter/main.swift" \
      -o "$arm64_binary" \
      -F "$SPARKLE_DIST_DIR" \
      -framework Cocoa \
      -framework ServiceManagement \
      -framework Sparkle \
      -Xlinker -rpath \
      -Xlinker @executable_path/../Frameworks \
      -framework WebKit
    lipo -create -output "$target" "$x86_binary" "$arm64_binary"
    rm -rf "$build_dir"
    chmod 755 "$target"
    return 0
  fi

  swiftc \
    "${ROOT}/macos/VibeTVControlCenter/main.swift" \
    -o "$target" \
    -F "$SPARKLE_DIST_DIR" \
    -framework Cocoa \
    -framework ServiceManagement \
    -framework Sparkle \
    -Xlinker -rpath \
    -Xlinker @executable_path/../Frameworks \
    -framework WebKit
  chmod 755 "$target"
}

main() {
  require_app_output_path

  local contents="${APP_DIR}/Contents"
  local macos_dir="${contents}/MacOS"
  local helpers_dir="${contents}/Helpers"
  local frameworks_dir="${contents}/Frameworks"
  local resources_dir="${contents}/Resources"
  local launch_agents_dir="${contents}/Library/LaunchAgents"

  rm -rf "$APP_DIR"
  mkdir -p "$macos_dir" "$helpers_dir" "$frameworks_dir" "$resources_dir" "$launch_agents_dir"

  prepare_sparkle
  write_info_plist "${contents}/Info.plist"
  build_executable "${macos_dir}/${EXECUTABLE_NAME}"
  copy_sparkle_framework "$frameworks_dir"
  copy_app_icon "$resources_dir"
  copy_control_center_static "${resources_dir}/control-center"
  copy_companion_binary "$helpers_dir"
  copy_runtime_agent_plist "${launch_agents_dir}/${RUNTIME_AGENT_PLIST_NAME}"
  cp "${ROOT}/macos/VibeTVControlCenter/VibeTVControlCenter.entitlements" "${resources_dir}/VibeTVControlCenter.entitlements"

  if command -v xattr >/dev/null 2>&1; then
    xattr -cr "$APP_DIR" >/dev/null 2>&1 || true
  fi

  printf 'built macOS app bundle: %s\n' "$APP_DIR"
}

main "$@"
