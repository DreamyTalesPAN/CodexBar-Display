#!/usr/bin/env bash
set -euo pipefail

REPO="DreamyTalesPAN/CodexBar-Display"
RELEASE_TAG=""
RELEASE_JSON=""
PKG_PATH=""
APP_URL=""
EXPECT_VERSION=""
CHECK_LOCAL=0
REQUIRE_SIGNED=0
REQUIRE_NOTARIZED=0

usage() {
  cat <<'EOF'
Usage:
  check-control-center-companion-customer-readiness.sh [options]

Read-only checks for the hosted Control Center customer Companion path.

Options:
  --repo owner/name                 GitHub repo. Default: DreamyTalesPAN/CodexBar-Display
  --release v1.2.3                 Check expected release asset names.
  --release-json path              Use a local GitHub release JSON fixture instead of GitHub API.
  --pkg path/to/package.pkg         Inspect a macOS Companion .pkg payload.
  --require-signed                 Fail if the package is not signed.
  --require-notarized              Fail if the package is not notarized/stapled.
  --app-url https://app.vibetv.shop Check hosted app HTTP reachability.
  --local-companion                Check local Companion status on 127.0.0.1:47832.
  --expect-version x.y.z           Require local Companion version when using --local-companion.
  -h, --help                       Show this help.

Examples:
  scripts/check-control-center-companion-customer-readiness.sh \
    --release v1.0.32 \
    --pkg dist/companion-pkg/VibeTV-Companion-API-arm64-v1.0.32.pkg \
    --require-signed \
    --require-notarized \
    --app-url https://app.vibetv.shop

  scripts/check-control-center-companion-customer-readiness.sh --local-companion

This script does not install packages, start services, discover devices, or perform
hardware writes. It is safe for preflight and customer-readiness audits.
EOF
}

log() {
  printf 'check: %s\n' "$*"
}

die() {
  printf 'error: %s\n' "$*" >&2
  exit 1
}

require_cmd() {
  command -v "$1" >/dev/null 2>&1 || die "$1 is required"
}

parse_args() {
  while [[ $# -gt 0 ]]; do
    case "$1" in
      -h|--help)
        usage
        exit 0
        ;;
      --repo)
        [[ $# -ge 2 ]] || die "--repo requires a value"
        REPO="$2"
        shift 2
        ;;
      --repo=*)
        REPO="${1#*=}"
        shift
        ;;
      --release)
        [[ $# -ge 2 ]] || die "--release requires a value"
        RELEASE_TAG="$2"
        shift 2
        ;;
      --release=*)
        RELEASE_TAG="${1#*=}"
        shift
        ;;
      --release-json)
        [[ $# -ge 2 ]] || die "--release-json requires a value"
        RELEASE_JSON="$2"
        shift 2
        ;;
      --release-json=*)
        RELEASE_JSON="${1#*=}"
        shift
        ;;
      --pkg)
        [[ $# -ge 2 ]] || die "--pkg requires a value"
        PKG_PATH="$2"
        shift 2
        ;;
      --pkg=*)
        PKG_PATH="${1#*=}"
        shift
        ;;
      --require-signed)
        REQUIRE_SIGNED=1
        shift
        ;;
      --require-notarized)
        REQUIRE_NOTARIZED=1
        shift
        ;;
      --app-url)
        [[ $# -ge 2 ]] || die "--app-url requires a value"
        APP_URL="$2"
        shift 2
        ;;
      --app-url=*)
        APP_URL="${1#*=}"
        shift
        ;;
      --local-companion)
        CHECK_LOCAL=1
        shift
        ;;
      --expect-version)
        [[ $# -ge 2 ]] || die "--expect-version requires a value"
        EXPECT_VERSION="${2#v}"
        shift 2
        ;;
      --expect-version=*)
        EXPECT_VERSION="${1#*=}"
        EXPECT_VERSION="${EXPECT_VERSION#v}"
        shift
        ;;
      *)
        die "unknown argument: $1"
        ;;
    esac
  done
}

release_json_path() {
  local out
  if [[ -n "$RELEASE_JSON" ]]; then
    [[ -f "$RELEASE_JSON" ]] || die "release JSON does not exist: $RELEASE_JSON"
    printf '%s\n' "$RELEASE_JSON"
    return
  fi

  [[ -n "$RELEASE_TAG" ]] || die "--release or --release-json is required for release checks"
  require_cmd curl
  out="$(mktemp "${TMPDIR:-/tmp}/vibetv-release.XXXXXX.json")"
  curl -fsSL \
    -H "Accept: application/vnd.github+json" \
    -H "X-GitHub-Api-Version: 2022-11-28" \
    "https://api.github.com/repos/${REPO}/releases/tags/${RELEASE_TAG}" \
    > "$out"
  printf '%s\n' "$out"
}

check_release_assets() {
  local json version
  [[ -n "$RELEASE_TAG" || -n "$RELEASE_JSON" ]] || return 0

  require_cmd python3
  json="$(release_json_path)"
  version="${RELEASE_TAG#v}"
  if [[ -z "$version" ]]; then
    version="$(python3 - "$json" <<'PY'
import json
import sys
with open(sys.argv[1], encoding="utf-8") as f:
    data = json.load(f)
print(str(data.get("tag_name", "")).lstrip("v"))
PY
)"
  fi

  [[ -n "$version" ]] || die "could not determine release version"
  python3 - "$json" "$version" <<'PY'
import json
import sys

path, version = sys.argv[1], sys.argv[2]
with open(path, encoding="utf-8") as f:
    data = json.load(f)

assets = {asset.get("name") for asset in data.get("assets", [])}
expected = {
    "install-control-center-companion.sh",
    f"VibeTV-Companion-API-arm64-v{version}.pkg",
    f"VibeTV-Companion-API-amd64-v{version}.pkg",
}
missing = sorted(expected - assets)
if missing:
    print("missing release assets:", ", ".join(missing), file=sys.stderr)
    sys.exit(1)
print(f"release assets ok for v{version}")
PY
}

check_package() {
  local expanded expanded_root signature_output
  [[ -n "$PKG_PATH" ]] || return 0

  [[ "$(uname -s)" == "Darwin" ]] || die "--pkg checks currently require macOS"
  require_cmd pkgutil
  [[ -f "$PKG_PATH" ]] || die "package does not exist: $PKG_PATH"

  expanded_root="$(mktemp -d "${TMPDIR:-/tmp}/vibetv-pkg-expanded.XXXXXX")"
  expanded="${expanded_root}/expanded"
  pkgutil --expand-full "$PKG_PATH" "$expanded"
  test -x "${expanded}/Payload/Library/Application Support/VibeTV/bin/codexbar-display" \
    || die "package payload missing Companion binary"
  test -f "${expanded}/Payload/Library/LaunchAgents/com.codexbar-display.companion-api.plist" \
    || die "package payload missing LaunchAgent plist"
  if find "${expanded}/Payload" -name '._*' | grep -q .; then
    die "package payload contains AppleDouble files"
  fi
  rm -rf "$expanded_root"
  log "package payload ok"

  if [[ "$REQUIRE_SIGNED" == 1 ]]; then
    signature_output="$(pkgutil --check-signature "$PKG_PATH" 2>&1 || true)"
    printf '%s\n' "$signature_output" | grep -q "Developer ID Installer" \
      || die "package is not signed with Developer ID Installer"
    log "package signature ok"
  fi

  if [[ "$REQUIRE_NOTARIZED" == 1 ]]; then
    require_cmd xcrun
    xcrun stapler validate "$PKG_PATH" >/dev/null
    log "package notarization staple ok"
  fi
}

check_app_url() {
  [[ -n "$APP_URL" ]] || return 0
  require_cmd curl
  curl -fsSIL "$APP_URL" >/dev/null
  log "app reachable: $APP_URL"
}

check_local_companion() {
  local response version
  [[ "$CHECK_LOCAL" == 1 ]] || return 0

  require_cmd curl
  require_cmd python3
  response="$(curl -fsS http://127.0.0.1:47832/v1/status)"
  version="$(printf '%s' "$response" | python3 -c '
import json
import sys
payload = json.load(sys.stdin)
print(payload.get("companion", {}).get("version", ""))
')"
  [[ -n "$version" ]] || die "local Companion did not report a version"
  if [[ -n "$EXPECT_VERSION" && "$version" != "$EXPECT_VERSION" ]]; then
    die "expected Companion version $EXPECT_VERSION, got $version"
  fi
  log "local Companion ok: version ${version}"
}

main() {
  parse_args "$@"
  check_release_assets
  check_package
  check_app_url
  check_local_companion
  log "customer-readiness checks passed"
}

main "$@"
