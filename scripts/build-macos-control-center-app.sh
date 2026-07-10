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
  build-macos-control-center-app.sh [--version x.y.z] [--build n] [--output path.app] [--control-center-static dir] [--companion-binary path] [--app-icon path.icns] [--universal] [--dry-run]

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
    cat > "${target_dir}/BUNDLED_COMPANION.md" <<EOF
# Bundled Companion placeholder

Real DMG builds must place the Darwin Companion binary here:

  ${APP_NAME}.app/Contents/Resources/companion/${COMPANION_NAME}

The native WebView shell starts that binary with:

  ${COMPANION_NAME} daemon --transport wifi --target http://vibetv.local --interval 30s --api-addr 127.0.0.1:47832 --api-dev-origin http://127.0.0.1:47832

The app registers this process as an app-managed LaunchAgent so display frames
continue after the Control Center window or app exits and after future logins.
EOF
    return 0
  fi

  die "real app builds need --companion-binary path/to/${COMPANION_NAME}"
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
      -framework Cocoa \
      -framework ServiceManagement \
      -framework WebKit
    swiftc \
      -target arm64-apple-macos13 \
      "${ROOT}/macos/VibeTVControlCenter/main.swift" \
      -o "$arm64_binary" \
      -framework Cocoa \
      -framework ServiceManagement \
      -framework WebKit
    lipo -create -output "$target" "$x86_binary" "$arm64_binary"
    rm -rf "$build_dir"
    chmod 755 "$target"
    return 0
  fi

  swiftc \
    "${ROOT}/macos/VibeTVControlCenter/main.swift" \
    -o "$target" \
    -framework Cocoa \
    -framework ServiceManagement \
    -framework WebKit
  chmod 755 "$target"
}

main() {
  require_app_output_path

  local contents="${APP_DIR}/Contents"
  local macos_dir="${contents}/MacOS"
  local resources_dir="${contents}/Resources"
  local launch_agents_dir="${contents}/Library/LaunchAgents"

  rm -rf "$APP_DIR"
  mkdir -p "$macos_dir" "$resources_dir" "$launch_agents_dir"

  write_info_plist "${contents}/Info.plist"
  build_executable "${macos_dir}/${EXECUTABLE_NAME}"
  copy_app_icon "$resources_dir"
  copy_control_center_static "${resources_dir}/control-center"
  copy_companion_binary "${resources_dir}/companion"
  [[ -f "$RUNTIME_AGENT_PLIST" ]] || die "runtime LaunchAgent plist not found: ${RUNTIME_AGENT_PLIST}"
  cp "$RUNTIME_AGENT_PLIST" "${launch_agents_dir}/${RUNTIME_AGENT_PLIST_NAME}"
  cp "${ROOT}/macos/VibeTVControlCenter/VibeTVControlCenter.entitlements" "${resources_dir}/VibeTVControlCenter.entitlements"

  if command -v xattr >/dev/null 2>&1; then
    xattr -cr "$APP_DIR" >/dev/null 2>&1 || true
  fi

  printf 'built macOS app bundle: %s\n' "$APP_DIR"
}

main "$@"
