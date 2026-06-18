#!/usr/bin/env bash
set -euo pipefail

SERVICE_LABEL="com.codexbar-display.companion-api"
PKG_IDENTIFIER="shop.vibetv.companion-api"
INSTALL_PREFIX="/Library/Application Support/VibeTV"
BIN_PATH="${INSTALL_PREFIX}/bin/codexbar-display"
PLIST_PATH="/Library/LaunchAgents/${SERVICE_LABEL}.plist"
ADDR="${VIBETV_COMPANION_ADDR:-127.0.0.1:47832}"
DEV_ORIGIN="${VIBETV_COMPANION_DEV_ORIGIN:-}"
VERSION=""
ARCH=""
BINARY=""
OUT_DIR=""
SIGN_IDENTITY="${VIBETV_PKG_SIGN_IDENTITY:-}"
NOTARY_PROFILE="${VIBETV_NOTARY_PROFILE:-}"
NOTARY_KEYCHAIN="${VIBETV_NOTARY_KEYCHAIN:-}"
TMPDIR_PKG=""

usage() {
  cat <<'EOF'
Usage:
  build-control-center-companion-pkg.sh --version x.y.z --arch arm64|amd64 --binary path/to/codexbar-display --out dist/companion-pkg

Optional:
  --sign-identity "Developer ID Installer: Company (TEAMID)"
  --notary-profile keychain-profile-name

What it does:
  - builds a macOS .pkg containing the Companion API binary
  - installs the binary under /Library/Application Support/VibeTV/bin
  - installs /Library/LaunchAgents/com.codexbar-display.companion-api.plist
  - starts or restarts the LaunchAgent for the current console user after install

Signing and notarization are optional and only run when configured.
EOF
}

die() {
  printf 'error: %s\n' "$*" >&2
  exit 1
}

cleanup() {
  if [[ -n "$TMPDIR_PKG" && -d "$TMPDIR_PKG" ]]; then
    rm -rf "$TMPDIR_PKG"
  fi
}

xml_escape() {
  local value="$1"
  value="${value//&/&amp;}"
  value="${value//</&lt;}"
  value="${value//>/&gt;}"
  value="${value//\"/&quot;}"
  printf '%s' "$value"
}

parse_args() {
  while [[ $# -gt 0 ]]; do
    case "$1" in
      -h|--help)
        usage
        exit 0
        ;;
      --version)
        [[ $# -ge 2 ]] || die "--version requires a value"
        VERSION="${2#v}"
        shift 2
        ;;
      --version=*)
        VERSION="${1#*=}"
        VERSION="${VERSION#v}"
        shift
        ;;
      --arch)
        [[ $# -ge 2 ]] || die "--arch requires a value"
        ARCH="$2"
        shift 2
        ;;
      --arch=*)
        ARCH="${1#*=}"
        shift
        ;;
      --binary)
        [[ $# -ge 2 ]] || die "--binary requires a value"
        BINARY="$2"
        shift 2
        ;;
      --binary=*)
        BINARY="${1#*=}"
        shift
        ;;
      --out)
        [[ $# -ge 2 ]] || die "--out requires a value"
        OUT_DIR="$2"
        shift 2
        ;;
      --out=*)
        OUT_DIR="${1#*=}"
        shift
        ;;
      --sign-identity)
        [[ $# -ge 2 ]] || die "--sign-identity requires a value"
        SIGN_IDENTITY="$2"
        shift 2
        ;;
      --sign-identity=*)
        SIGN_IDENTITY="${1#*=}"
        shift
        ;;
      --notary-profile)
        [[ $# -ge 2 ]] || die "--notary-profile requires a value"
        NOTARY_PROFILE="$2"
        shift 2
        ;;
      --notary-profile=*)
        NOTARY_PROFILE="${1#*=}"
        shift
        ;;
      *)
        die "unknown argument: $1"
        ;;
    esac
  done
}

require_inputs() {
  [[ "$(uname -s)" == "Darwin" ]] || die "macOS is required to build .pkg installers"
  command -v pkgbuild >/dev/null 2>&1 || die "pkgbuild is required"
  [[ -n "$VERSION" ]] || die "--version is required"
  [[ "$ARCH" == "arm64" || "$ARCH" == "amd64" ]] || die "--arch must be arm64 or amd64"
  [[ -n "$BINARY" && -f "$BINARY" ]] || die "--binary must point to an existing codexbar-display binary"
  [[ -n "$OUT_DIR" ]] || die "--out is required"
}

write_plist() {
  local plist="$1"
  local args=("$BIN_PATH" "api" "--addr" "$ADDR")
  if [[ -n "$DEV_ORIGIN" ]]; then
    args+=("--dev-origin" "$DEV_ORIGIN")
  fi

  {
    cat <<PLIST_HEAD
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
  <dict>
    <key>Label</key>
    <string>${SERVICE_LABEL}</string>

    <key>ProgramArguments</key>
    <array>
PLIST_HEAD

    for arg in "${args[@]}"; do
      printf '      <string>%s</string>\n' "$(xml_escape "$arg")"
    done

    cat <<PLIST_TAIL
    </array>

    <key>EnvironmentVariables</key>
    <dict>
      <key>PATH</key>
      <string>/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin</string>
    </dict>

    <key>RunAtLoad</key>
    <true/>

    <key>KeepAlive</key>
    <true/>

    <key>StandardOutPath</key>
    <string>/tmp/codexbar-display-companion-api.out.log</string>

    <key>StandardErrorPath</key>
    <string>/tmp/codexbar-display-companion-api.err.log</string>
  </dict>
</plist>
PLIST_TAIL
  } > "$plist"
}

write_postinstall() {
  local postinstall="$1"
  cat > "$postinstall" <<'EOF'
#!/bin/bash
set -e

label="com.codexbar-display.companion-api"
plist="/Library/LaunchAgents/${label}.plist"
console_user="$(stat -f %Su /dev/console 2>/dev/null || true)"

if [[ -z "$console_user" || "$console_user" == "root" || "$console_user" == "loginwindow" ]]; then
  exit 0
fi

uid="$(id -u "$console_user" 2>/dev/null || true)"
if [[ -z "$uid" ]]; then
  exit 0
fi

launchctl bootout "gui/${uid}/${label}" >/dev/null 2>&1 || true
launchctl bootstrap "gui/${uid}" "$plist" >/dev/null 2>&1 || true
launchctl enable "gui/${uid}/${label}" >/dev/null 2>&1 || true
launchctl kickstart -k "gui/${uid}/${label}" >/dev/null 2>&1 || true

exit 0
EOF
  chmod 755 "$postinstall"
}

build_pkg() {
  local root scripts pkg_name pkg_path
  TMPDIR_PKG="$(mktemp -d "${TMPDIR:-/tmp}/vibetv-companion-pkg.XXXXXX")"
  trap cleanup EXIT INT TERM

  root="${TMPDIR_PKG}/root"
  scripts="${TMPDIR_PKG}/scripts"
  mkdir -p "${root}${INSTALL_PREFIX}/bin" "${root}/Library/LaunchAgents" "$scripts" "$OUT_DIR"

  cp "$BINARY" "${root}${BIN_PATH}"
  chmod 755 "${root}${BIN_PATH}"
  write_plist "${root}${PLIST_PATH}"
  chmod 644 "${root}${PLIST_PATH}"
  write_postinstall "${scripts}/postinstall"
  if command -v xattr >/dev/null 2>&1; then
    xattr -cr "$root" "$scripts" >/dev/null 2>&1 || true
  fi
  find "$root" "$scripts" -name '._*' -delete

  pkg_name="VibeTV-Companion-API-${ARCH}-v${VERSION}.pkg"
  pkg_path="${OUT_DIR}/${pkg_name}"

  pkg_args=(
    --root "$root"
    --scripts "$scripts"
    --identifier "$PKG_IDENTIFIER"
    --version "$VERSION"
    --install-location /
    --filter '\.DS_Store$'
    --filter '(^|/)\.svn($|/)'
    --filter '(^|/)CVS($|/)'
    --filter '(^|/)\._[^/]*$'
  )
  if [[ -n "$SIGN_IDENTITY" ]]; then
    pkg_args+=(--sign "$SIGN_IDENTITY")
  fi
  pkg_args+=("$pkg_path")

  COPYFILE_DISABLE=1 pkgbuild "${pkg_args[@]}"

  if [[ -n "$NOTARY_PROFILE" ]]; then
    command -v xcrun >/dev/null 2>&1 || die "xcrun is required for notarization"
    notary_args=(notarytool submit "$pkg_path" --keychain-profile "$NOTARY_PROFILE" --wait)
    if [[ -n "$NOTARY_KEYCHAIN" ]]; then
      notary_args+=(--keychain "$NOTARY_KEYCHAIN")
    fi
    xcrun "${notary_args[@]}"
    xcrun stapler staple "$pkg_path"
  fi

  printf '%s\n' "$pkg_path"
}

main() {
  parse_args "$@"
  require_inputs
  build_pkg
}

main "$@"
